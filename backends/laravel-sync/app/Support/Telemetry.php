<?php

declare(strict_types=1);

namespace App\Support;

use OpenTelemetry\API\Trace\SpanInterface;
use OpenTelemetry\API\Trace\SpanKind;
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
 * Instrumentação OpenTelemetry da composição síncrona. Desligada por padrão: quando
 * OTEL_ENABLED != "1" todas as operações são no-op e o código quente não paga nada (a bateria
 * estatística roda assim, ver scripts/run_tcc_suite.sh). Só com OTEL_ENABLED=1 um TracerProvider
 * é montado, exportando por OTLP/HTTP para o Jaeger (host.docker.internal:4318), com amostragem
 * por proporção de trace (padrão 0,02) para não distorcer a latência medida.
 *
 * O SDK é opcional em tempo de execução: se os pacotes open-telemetry/* não estiverem instalados,
 * enabled() devolve false e a aplicação segue sem tracing. Carrega os pacotes via composer
 * (open-telemetry/sdk + open-telemetry/exporter-otlp), sem a extensão C.
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
        self::$enabled = getenv('OTEL_ENABLED') === '1'
            && class_exists(TracerProvider::class);
        return self::$enabled;
    }

    private static function tracer(): ?TracerInterface
    {
        if (! self::enabled()) {
            return null;
        }
        if (self::$tracer !== null) {
            return self::$tracer;
        }
        $endpoint = rtrim(getenv('OTEL_EXPORTER_OTLP_ENDPOINT')
            ?: 'http://host.docker.internal:4318', '/').'/v1/traces';
        $ratio = (float) (getenv('OTEL_TRACES_SAMPLER_ARG') ?: '0.02');

        $transport = (new OtlpHttpTransportFactory())->create($endpoint, 'application/x-protobuf');
        $exporter = new SpanExporter($transport);
        $resource = ResourceInfoFactory::defaultResource()->merge(ResourceInfo::create(Attributes::create([
            ResourceAttributes::SERVICE_NAME => getenv('OTEL_SERVICE_NAME') ?: 'laravel-sync',
        ])));
        $provider = new TracerProvider(
            new SimpleSpanProcessor($exporter),
            new ParentBased(new TraceIdRatioBasedSampler($ratio)),
            $resource,
        );
        self::$tracer = $provider->getTracer('tcc.laravel-sync');
        return self::$tracer;
    }

    /**
     * Executa $callback dentro de um span (quando habilitado) ou direto (no-op quando desligado).
     *
     * @template T
     * @param callable():T $callback
     * @param array<string, scalar> $attributes
     * @return T
     */
    public static function span(string $name, callable $callback, array $attributes = []): mixed
    {
        $tracer = self::tracer();
        if ($tracer === null) {
            return $callback();
        }
        /** @var SpanInterface $span */
        $span = $tracer->spanBuilder($name)->setSpanKind(SpanKind::KIND_SERVER)->startSpan();
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
}
