<?php
declare(strict_types=1);
namespace App\Worker;

use App\Repository\ShareRepository;
use App\Infrastructure\Telemetry\Telemetry;
use PhpAmqpLib\Message\AMQPMessage;

final class ShareBatchProcessor
{
    public function __construct(private ShareRepository $shares) {}

    /**
     * Um lote = uma transação Cypher. Se o commit falhar (ex.: timeout num lote com fan-out de
     * celebridade), divide o lote ao meio e tenta de novo. ACK somente depois do commit que
     * contém a mensagem. Devolve as mensagens que falharam mesmo isoladas (sem ACK).
     *
     * @param list<AMQPMessage> $messages
     * @return list<AMQPMessage>
     */
    public function process(array $messages): array
    {
        $payloads = [];
        foreach ($messages as $index => $message) {
            try {
                $payloads[] = json_decode($message->body, true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $message->nack(false); // mensagem corrompida não volta à fila
                unset($messages[$index]);
            }
        }
        $messages = array_values($messages);
        if (!$messages) {
            return [];
        }
        try {
            // Span do lote persistido (UNWIND no Neo4j). O lote mistura mensagens de traces
            // distintos; cada traceparent de origem entra como SPAN LINK, sem forjar hierarquia.
            $traceparents = array_map(fn (AMQPMessage $m) => self::traceparentOf($m), $messages);
            $result = Telemetry::batchSpan('shares UNWIND Neo4j', $traceparents,
                fn () => $this->shares->persistBatch($payloads),
                ['lote' => count($messages)]);
        } catch (\RuntimeException $error) {
            if (count($messages) === 1) {
                fwrite(STDERR, 'shares: '.$error->getMessage().PHP_EOL);
                return $messages;
            }
            $half = intdiv(count($messages), 2);
            return [...$this->process(array_slice($messages, 0, $half)), ...$this->process(array_slice($messages, $half))];
        }
        foreach ($messages as $message) {
            $message->ack();
        }
        // Já gravados como (:ShareDuplicate) no mesmo commit; o log é só por lote (lote reenviado repete a linha).
        if ($result['duplicados'] > 0 || $result['ausentes'] > 0) {
            fwrite(STDERR, sprintf('shares: lote=%d deduplicados=%d ausentes=%d'.PHP_EOL,
                count($messages), $result['duplicados'], $result['ausentes']));
        }
        return [];
    }

    /** Lê o header AMQP `traceparent` de uma mensagem; null quando ausente (rastreamento desligado). */
    private static function traceparentOf(AMQPMessage $message): ?string
    {
        if (! $message->has('application_headers')) {
            return null;
        }
        $headers = $message->get('application_headers');
        $data = $headers instanceof \PhpAmqpLib\Wire\AMQPTable ? $headers->getNativeData() : $headers;
        $value = is_array($data) ? ($data['traceparent'] ?? null) : null;
        return is_string($value) ? $value : null;
    }
}
