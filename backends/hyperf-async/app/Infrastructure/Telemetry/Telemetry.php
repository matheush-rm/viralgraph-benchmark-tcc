<?php
declare(strict_types=1);
namespace App\Infrastructure\Telemetry;

use OpenTelemetry\API\Trace\SpanContext;
use OpenTelemetry\API\Trace\SpanContextInterface;
use OpenTelemetry\API\Trace\SpanInterface;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\TraceFlags;
use OpenTelemetry\API\Trace\TracerInterface;
use OpenTelemetry\Contrib\Otlp\OtlpHttpTransportFactory;
use OpenTelemetry\Contrib\Otlp\SpanExporter;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SDK\Trace\Sampler\ParentBased;
use OpenTelemetry\SDK\Trace\Sampler\TraceIdRatioBasedSampler;
use OpenTelemetry\SDK\Trace\SpanProcessor\SimpleSpanProcessor;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SemConv\ResourceAttributes;

/**
 * Instrumentação OpenTelemetry da composição assíncrona (Hyperf/Swoole long-lived).
 *
 * O TracerProvider é montado UMA vez por processo (bootstrap em bin/hyperf.php e bin/worker.php),
 * não por requisição: num servidor Swoole de longa duração reconstruí-lo a cada chamada vazaria
 * recursos. Quando OTEL_ENABLED != "1" tudo é no-op e o caminho quente não paga nada (a bateria
 * estatística de scripts/run_tcc_suite.sh roda assim).
 *
 * Propagação W3C traceparent feita à mão (inject/extract), sem depender da extensão C: o publisher
 * injeta o traceparent nos headers AMQP e o worker o extrai de cada mensagem. Como um lote mistura
 * mensagens de vários traces, o span do lote (UNWIND no Neo4j) usa SPAN LINKS para cada traceparent
 * de origem, em vez de forjar uma única hierarquia pai-filho.
 */
final class Telemetry
{
    private static ?bool $enabled = null;
    private static ?TracerInterface $tracer = null;

    public static function enabled(): bool
    {
        if (self::$enabled !== null) {
            return self::$enabled;
        }
        self::$enabled = getenv('OTEL_ENABLED') === '1' && class_exists(TracerProvider::class);
        return self::$enabled;
    }

    /** Monta o TracerProvider uma única vez por processo. Idempotente: chamadas extras não têm efeito. */
    public static function bootstrap(string $service): void
    {
        if (! self::enabled() || self::$tracer !== null) {
            return;
        }
        $endpoint = rtrim(getenv('OTEL_EXPORTER_OTLP_ENDPOINT')
            ?: 'http://host.docker.internal:4318', '/').'/v1/traces';
        $ratio = (float) (getenv('OTEL_TRACES_SAMPLER_ARG') ?: '0.02');
        $transport = (new OtlpHttpTransportFactory())->create($endpoint, 'application/x-protobuf');
        $exporter = new SpanExporter($transport);
        $resource = ResourceInfoFactory::defaultResource()->merge(ResourceInfo::create(Attributes::create([
            ResourceAttributes::SERVICE_NAME => getenv('OTEL_SERVICE_NAME') ?: $service,
        ])));
        $provider = new TracerProvider(
            new SimpleSpanProcessor($exporter),
            new ParentBased(new TraceIdRatioBasedSampler($ratio)),
            $resource,
        );
        self::$tracer = $provider->getTracer('tcc.hyperf-async');
    }

    private static function tracer(): ?TracerInterface
    {
        if (! self::enabled()) {
            return null;
        }
        if (self::$tracer === null) {
            self::bootstrap(getenv('OTEL_SERVICE_NAME') ?: 'hyperf-async');
        }
        return self::$tracer;
    }

    /**
     * Executa $callback dentro de um span KIND_SERVER. Devolve o traceparent W3C do span (string)
     * por referência em $traceparent, para injeção no evento AMQP. No-op quando desligado.
     *
     * @template T
     * @param callable():T $callback
     * @param array<string, scalar> $attributes
     * @return T
     */
    public static function serverSpan(string $name, callable $callback, array $attributes = [], ?string &$traceparent = null): mixed
    {
        $tracer = self::tracer();
        if ($tracer === null) {
            $traceparent = null;
            return $callback();
        }
        /** @var SpanInterface $span */
        $span = $tracer->spanBuilder($name)->setSpanKind(SpanKind::KIND_SERVER)->startSpan();
        foreach ($attributes as $key => $value) {
            $span->setAttribute($key, $value);
        }
        $traceparent = self::formatTraceparent($span->getContext());
        $scope = $span->activate();
        try {
            return $callback();
        } catch (\Throwable $error) {
            $span->recordException($error);
            throw $error;
        } finally {
            $scope->detach();
            $span->end();
        }
    }

    /**
     * Span do lote persistido no Neo4j (UNWIND). Como o lote agrega mensagens de traces diferentes,
     * cada traceparent de origem entra como SPAN LINK (sem hierarquia forjada). No-op quando desligado.
     *
     * @template T
     * @param list<string|null> $traceparents  traceparents W3C extraídos das mensagens do lote
     * @param callable():T $callback
     * @param array<string, scalar> $attributes
     * @return T
     */
    public static function batchSpan(string $name, array $traceparents, callable $callback, array $attributes = []): mixed
    {
        $tracer = self::tracer();
        if ($tracer === null) {
            return $callback();
        }
        $builder = $tracer->spanBuilder($name)->setSpanKind(SpanKind::KIND_CONSUMER);
        foreach ($traceparents as $parent) {
            $context = self::parseTraceparent($parent);
            if ($context !== null && $context->isValid()) {
                $builder->addLink($context);
            }
        }
        /** @var SpanInterface $span */
        $span = $builder->startSpan();
        foreach ($attributes as $key => $value) {
            $span->setAttribute($key, $value);
        }
        $scope = $span->activate();
        try {
            return $callback();
        } catch (\Throwable $error) {
            $span->recordException($error);
            throw $error;
        } finally {
            $scope->detach();
            $span->end();
        }
    }

    /** Serializa um SpanContext no formato W3C traceparent (version-traceid-spanid-flags). */
    public static function formatTraceparent(SpanContextInterface $context): ?string
    {
        if (! $context->isValid()) {
            return null;
        }
        return sprintf('00-%s-%s-%02x', $context->getTraceId(), $context->getSpanId(),
            $context->getTraceFlags());
    }

    /** Converte um header W3C traceparent num SpanContext remoto; null se malformado. */
    public static function parseTraceparent(?string $traceparent): ?SpanContextInterface
    {
        if ($traceparent === null) {
            return null;
        }
        $parts = explode('-', trim($traceparent));
        if (count($parts) !== 4 || strlen($parts[1]) !== 32 || strlen($parts[2]) !== 16) {
            return null;
        }
        $flags = hexdec($parts[3]) & TraceFlags::SAMPLED ? TraceFlags::SAMPLED : TraceFlags::DEFAULT;
        return SpanContext::createFromRemoteParent($parts[1], $parts[2], $flags);
    }
}
