<?php
declare(strict_types=1);
namespace App\Repository;

use App\Infrastructure\Neo4j\Neo4jClient;

final class MetricsRepository
{
    public function __construct(private Neo4jClient $client) {}

    /** Contagens por label/tipo de relação vêm do count store do Neo4j, sem varrer dados. */
    public function metrics(): array
    {
        $r = $this->client->run('CALL { MATCH (u:User) RETURN count(u) AS usuarios }
            CALL { MATCH ()-[f:FOLLOWS]->() RETURN count(f) AS relacoes_seguir }
            CALL { MATCH (p:Post) RETURN count(p) AS posts_criados }
            CALL { MATCH ()-[s:SHARED]->() RETURN count(s) AS compartilhamentos }
            CALL { MATCH ()-[e:FEED]->() RETURN count(e) AS entradas_feed }
            CALL { MATCH (d:ShareDuplicate) RETURN count(d) AS deduplicados }
            RETURN usuarios, usuarios AS feeds, relacoes_seguir, posts_criados, compartilhamentos, entradas_feed,
                deduplicados')[0];
        // Shares aceitos (202) e absorvidos pelo MERGE idempotente no worker; não é insert lógico.
        $deduplicated = $r['deduplicados'];
        unset($r['deduplicados']);
        $r['inserts_logicos'] = array_sum($r);
        $r['compartilhamentos_deduplicados'] = $deduplicated;
        return $r;
    }
}
