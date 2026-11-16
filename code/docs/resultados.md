# Resultados dos experimentos

> **Documento gerado automaticamente por `scripts/resultados.py` a partir de
> `code/k6/results/`. Não editar manualmente.** Todos os números abaixo provêm de execuções
> reais realizadas neste repositório; estimativas e números não coletados não são impressos.
> A interpretação, as comparações conclusivas e as conclusões pertencem à monografia.

- Execuções registradas: 22 (baseline: 8, viralização: 14).
- Origem dos dados: `code/k6/results/*/summary.json` (k6 `--summary-export`), `metricas*.json`
  (`GET /metricas`) e `contagens.json` (contagens diretas no banco, cenários de viralização).
- `contract_errors` é a taxa de violações de contrato HTTP (`status`, `id` requisitado e campos
  do schema `Usuario`); `falha HTTP` é `http_req_failed` do k6. `thresholds` indica se todos os
  thresholds declarados no script passaram na execução.

## Baseline — busca de perfil por ID (GET /usuarios/{id})

Cenário de controle: leitura pontual de perfil sob alta concorrência, distribuição Pareto 80/20 sobre 10.020 usuários (hot set de 500). Detalhes em [baseline-user-lookup.md](baseline-user-lookup.md).

| execução (UTC) | arq. | modo | VUs | duração (s) | reqs | req/s | p50 | p95 | p99 | média | máx | falha HTTP | contract_errors | 5xx | timeouts | thresholds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-15 16:35:49Z | sync | smoke | 80 | 44 | 700 | 16 | 1283.8 | 10031.5 | 10462.5 | 3922.1 | 10728.6 | 0 | 0 | 0 | 0 | não |
| 2026-11-15 16:41:15Z | async | smoke | 80 | 41 | 1300 | 31.9 | 2100.2 | 4699 | 5906.9 | 2093.8 | 7100.7 | 0 | 0 | 0 | 0 | não |
| 2026-11-15 17:31:35Z | sync | smoke | 80 | 40 | 2608 | 65.2 | 1070.3 | 1765.5 | 1995.6 | 1014.7 | 3052.7 | 0 | 0 | 0 | 0 | não |
| 2026-11-15 17:35:28Z | async | smoke | 80 | 40 | 1497 | 37 | 1700.3 | 4399.3 | 5610.8 | 1795.5 | 7882.4 | 0 | 0 | 0 | 0 | não |
| 2026-11-16 01:16:15Z | sync | smoke | 80 | 40 | 2780 | 69.4 | 191.2 | 2292.2 | 2492.8 | 956 | 4287.5 | 0 | 0 | 0 | 0 | não |
| 2026-11-16 01:28:32Z | async | smoke | 80 | 40 | 1632 | 40.4 | 1614.9 | 3897.4 | 4766.3 | 1648.2 | 5699.5 | 0 | 0 | 0 | 0 | não |
| 2026-11-16 01:53:51Z | sync | smoke | 80 | 40 | 2973 | 74.3 | 91.8 | 2288.2 | 2492.4 | 889.8 | 2790.5 | 0 | 0 | 0 | 0 | não |
| 2026-11-16 02:05:34Z | async | smoke | 80 | 40 | 1471 | 36.6 | 1739.3 | 4402.6 | 5603.3 | 1827.4 | 7403.5 | 0 | 0 | 0 | 0 | não |


### baseline-sync-smoke-20261115T163549Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| user_lookup | 1283.8 | 10031.5 | 10462.5 | 10728.6 |


| métrica | expressão | ok |
| --- | --- | --- |
| contract_errors | `rate==0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration | `p(95)<500` | ✗ |
| http_req_duration | `p(99)<1000` | ✗ |
| http_req_duration{name:user_lookup} | `p(99)>=0` | ✓ |
| http_req_failed | `rate<0.01` | ✓ |
| http_req_failed{name:user_lookup} | `rate>=0` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| user_lookups | `count>=0` | ✓ |


Estado em `/metricas` antes × depois da carga: **inalterado = sim**.

```json
{
  "usuarios": 10020,
  "feeds": 10020,
  "relacoes_seguir": 126323,
  "posts_criados": 15003,
  "compartilhamentos": 34297,
  "entradas_feed": 532820,
  "inserts_logicos": 728483
}
```


### baseline-async-smoke-20261115T164115Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| user_lookup | 2100.2 | 4699 | 5906.9 | 7100.7 |


| métrica | expressão | ok |
| --- | --- | --- |
| contract_errors | `rate==0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration | `p(95)<500` | ✗ |
| http_req_duration | `p(99)<1000` | ✗ |
| http_req_duration{name:user_lookup} | `p(99)>=0` | ✓ |
| http_req_failed | `rate<0.01` | ✓ |
| http_req_failed{name:user_lookup} | `rate>=0` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| user_lookups | `count>=0` | ✓ |


Estado em `/metricas` antes × depois da carga: **inalterado = sim**.

```json
{
  "usuarios": 10020,
  "feeds": 10020,
  "relacoes_seguir": 126323,
  "posts_criados": 15003,
  "compartilhamentos": 34297,
  "entradas_feed": 532820,
  "inserts_logicos": 728483,
  "compartilhamentos_deduplicados": 0
}
```


### baseline-sync-smoke-20261115T173135Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| user_lookup | 1070.3 | 1765.5 | 1995.6 | 3052.7 |


| métrica | expressão | ok |
| --- | --- | --- |
| contract_errors | `rate==0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration | `p(95)<500` | ✗ |
| http_req_duration | `p(99)<1000` | ✗ |
| http_req_duration{name:user_lookup} | `p(99)>=0` | ✓ |
| http_req_failed | `rate<0.01` | ✓ |
| http_req_failed{name:user_lookup} | `rate>=0` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| user_lookups | `count>=0` | ✓ |


Estado em `/metricas` antes × depois da carga: **inalterado = sim**.

```json
{
  "usuarios": 10020,
  "feeds": 10020,
  "relacoes_seguir": 126323,
  "posts_criados": 15003,
  "compartilhamentos": 34297,
  "entradas_feed": 532820,
  "inserts_logicos": 728483
}
```


### baseline-async-smoke-20261115T173528Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| user_lookup | 1700.3 | 4399.3 | 5610.8 | 7882.4 |


| métrica | expressão | ok |
| --- | --- | --- |
| contract_errors | `rate==0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration | `p(95)<500` | ✗ |
| http_req_duration | `p(99)<1000` | ✗ |
| http_req_duration{name:user_lookup} | `p(99)>=0` | ✓ |
| http_req_failed | `rate<0.01` | ✓ |
| http_req_failed{name:user_lookup} | `rate>=0` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| user_lookups | `count>=0` | ✓ |


Estado em `/metricas` antes × depois da carga: **inalterado = sim**.

```json
{
  "usuarios": 10020,
  "feeds": 10020,
  "relacoes_seguir": 126323,
  "posts_criados": 15003,
  "compartilhamentos": 34297,
  "entradas_feed": 532820,
  "inserts_logicos": 728483,
  "compartilhamentos_deduplicados": 0
}
```


### baseline-sync-smoke-20261116T011615Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| user_lookup | 191.2 | 2292.2 | 2492.8 | 4287.5 |


| métrica | expressão | ok |
| --- | --- | --- |
| contract_errors | `rate==0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration | `p(95)<500` | ✗ |
| http_req_duration | `p(99)<1000` | ✗ |
| http_req_duration{name:user_lookup} | `p(99)>=0` | ✓ |
| http_req_failed | `rate<0.01` | ✓ |
| http_req_failed{name:user_lookup} | `rate>=0` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| user_lookups | `count>=0` | ✓ |


Estado em `/metricas` antes × depois da carga: **inalterado = sim**.

```json
{
  "usuarios": 10020,
  "feeds": 10020,
  "relacoes_seguir": 126323,
  "posts_criados": 15003,
  "compartilhamentos": 34297,
  "entradas_feed": 532820,
  "inserts_logicos": 728483
}
```


### baseline-async-smoke-20261116T012832Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| user_lookup | 1614.9 | 3897.4 | 4766.3 | 5699.5 |


| métrica | expressão | ok |
| --- | --- | --- |
| contract_errors | `rate==0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration | `p(95)<500` | ✗ |
| http_req_duration | `p(99)<1000` | ✗ |
| http_req_duration{name:user_lookup} | `p(99)>=0` | ✓ |
| http_req_failed | `rate<0.01` | ✓ |
| http_req_failed{name:user_lookup} | `rate>=0` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| user_lookups | `count>=0` | ✓ |


Estado em `/metricas` antes × depois da carga: **inalterado = sim**.

```json
{
  "usuarios": 10020,
  "feeds": 10020,
  "relacoes_seguir": 126323,
  "posts_criados": 15003,
  "compartilhamentos": 34297,
  "entradas_feed": 532820,
  "inserts_logicos": 728483,
  "compartilhamentos_deduplicados": 0
}
```


### baseline-sync-smoke-20261116T015351Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| user_lookup | 91.8 | 2288.2 | 2492.4 | 2790.5 |


| métrica | expressão | ok |
| --- | --- | --- |
| contract_errors | `rate==0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration | `p(95)<500` | ✗ |
| http_req_duration | `p(99)<1000` | ✗ |
| http_req_duration{name:user_lookup} | `p(99)>=0` | ✓ |
| http_req_failed | `rate<0.01` | ✓ |
| http_req_failed{name:user_lookup} | `rate>=0` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| user_lookups | `count>=0` | ✓ |


Estado em `/metricas` antes × depois da carga: **inalterado = sim**.

```json
{
  "usuarios": 10020,
  "feeds": 10020,
  "relacoes_seguir": 126323,
  "posts_criados": 15003,
  "compartilhamentos": 34297,
  "entradas_feed": 532820,
  "inserts_logicos": 728483
}
```


### baseline-async-smoke-20261116T020534Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| user_lookup | 1739.3 | 4402.6 | 5603.3 | 7403.5 |


| métrica | expressão | ok |
| --- | --- | --- |
| contract_errors | `rate==0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration | `p(95)<500` | ✗ |
| http_req_duration | `p(99)<1000` | ✗ |
| http_req_duration{name:user_lookup} | `p(99)>=0` | ✓ |
| http_req_failed | `rate<0.01` | ✓ |
| http_req_failed{name:user_lookup} | `rate>=0` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| user_lookups | `count>=0` | ✓ |


Estado em `/metricas` antes × depois da carga: **inalterado = sim**.

```json
{
  "usuarios": 10020,
  "feeds": 10020,
  "relacoes_seguir": 126323,
  "posts_criados": 15003,
  "compartilhamentos": 34297,
  "entradas_feed": 532820,
  "inserts_logicos": 728483,
  "compartilhamentos_deduplicados": 0
}
```


## Viralização (viral.js)

Cenários de escrita/leitura sobre o snapshot Zipf: cascatas de compartilhamento, fan-out de celebridades e leituras de feed/árvore. Além das misturas estáticas (`baseline`, `fanout`, `graph_read`, `mixed`), incluem-se `organic` (escrita comum sem celebridade, rampa suave) e `viral_peak` (cascata em fases: aquecimento, pico de centralidade, platô e resfriamento). Detalhes em [viralizacao.md](viralizacao.md). As colunas `pico fila` e `drenagem (s)` trazem o pico de profundidade de fila observado (`drenagem.pico_fila`) e o tempo total até a parada completa da drenagem (`drenagem.segundos_total`); contagens `aceitos × persistidos` e drenagem completas em `contagens.json`.

| execução (UTC) | arq. | modo | VUs | duração (s) | reqs | req/s | p50 | p95 | p99 | média | máx | falha HTTP | 5xx | timeouts | pico fila | drenagem (s) | thresholds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-15 18:04:56Z | sync | smoke | 50 | 41 | 1550 | 37.8 | 743 | 2099.1 | 3010.6 | 823.6 | 4749.7 | 0.001 | 2 | 0 | 0 | 5 | sim |
| 2026-11-15 23:10:22Z | async | smoke | 50 | 51 | 833 | 16.5 | 1603.3 | 4189.9 | 5705.5 | 1757.1 | 7535.3 | 0 | 0 | 0 | 244 | 75 | sim |
| 2026-11-15 23:18:52Z | sync | smoke | 50 | 42 | 1430 | 34.4 | 843.5 | 2237 | 3135.5 | 916.5 | 5936.1 | 0 | 0 | 0 | 0 | 5 | sim |
| 2026-11-15 23:28:26Z | async | smoke | 50 | 51 | 861 | 16.9 | 1374.5 | 4671.8 | 6540.3 | 1647.5 | 9812.7 | 0 | 0 | 0 | 220 | 29 | sim |
| 2026-11-15 23:33:10Z | sync | smoke | 50 | 66 | 325 | 4.9 | 19.1 | 30000.3 | 30001 | 3485.2 | 30001.3 | 0.086 | 1 | 27 | 0 | 58 | sim |
| 2026-11-15 23:44:29Z | async | smoke | 50 | 56 | 1344 | 24 | 679.9 | 2433.5 | 3613.6 | 908.1 | 6528.9 | 0 | 0 | 0 | 663 | 405 | sim |
| 2026-11-16 01:20:01Z | sync | smoke | 50 | 41 | 1606 | 39.1 | 624.7 | 2139.4 | 2887.6 | 791.9 | 4330.5 | 0 | 0 | 0 | 0 | 5 | sim |
| 2026-11-16 01:23:56Z | sync | smoke | 50 | 67 | 331 | 4.9 | 17.5 | 30000.3 | 30000.9 | 3949.7 | 30001.3 | 0.066 | 1 | 21 | 0 | 56 | sim |
| 2026-11-16 01:36:53Z | async | smoke | 50 | 51 | 1095 | 21.5 | 1053.8 | 3201 | 4468.5 | 1275.2 | 6348.9 | 0 | 0 | 0 | 312 | 33 | sim |
| 2026-11-16 01:45:57Z | async | smoke | 50 | 56 | 1134 | 20.4 | 767.1 | 3488.3 | 5584.5 | 1116.5 | 7893.8 | 0 | 0 | 0 | 590 | 375 | sim |
| 2026-11-16 01:57:36Z | sync | smoke | 50 | 41 | 1502 | 36.5 | 707.9 | 2113.9 | 3098.1 | 853.5 | 5059.9 | 0.001 | 1 | 0 | 0 | 5 | sim |
| 2026-11-16 02:01:27Z | sync | smoke | 50 | 62 | 362 | 5.9 | 17.5 | 29242.3 | 30000.8 | 3457.4 | 30001.2 | 0.052 | 2 | 17 | 0 | 58 | sim |
| 2026-11-16 02:14:14Z | async | smoke | 50 | 50 | 1441 | 28.7 | 768.4 | 2273.5 | 3187.3 | 914.5 | 4466.4 | 0 | 0 | 0 | 427 | 35 | sim |
| 2026-11-16 02:23:15Z | async | smoke | 50 | 56 | 1114 | 19.9 | 771.7 | 3497 | 5338.2 | 1133.5 | 7588 | 0 | 0 | 0 | 602 | 379 | sim |


### viral-sync-smoke-organic-20261115T180456Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 0 | 0 | 0 | 0 |
| celebrity_share | 0 | 0 | 0 | 0 |
| feed | 569.4 | 1493 | 1839.2 | 2526.4 |
| posts_create | 1350.7 | 2869.8 | 3532 | 3797.5 |
| propagation_tree | 562 | 1443.7 | 1597.5 | 2203.5 |
| share | 1268.7 | 2704.3 | 3696.4 | 4749.7 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 86,
    "shares": 378
  },
  "persistidos_final": {
    "posts": 86,
    "shares": 378,
    "feed_items": 1933,
    "shares_deduplicados": 0
  },
  "drenagem": {
    "completa": true,
    "segundos": 0,
    "segundos_total": 5,
    "pico_fila": 0,
    "pico_fila_k6": 0,
    "pico_fila_drenagem": 0,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-async-smoke-organic-20261115T231022Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 0 | 0 | 0 | 0 |
| celebrity_share | 0 | 0 | 0 | 0 |
| feed | 1263.7 | 3133.9 | 4087.7 | 4526.1 |
| posts_create | 1713.1 | 2556 | 2791.9 | 2915.7 |
| propagation_tree | 2302.6 | 5112.8 | 6416.3 | 7535.3 |
| share | 1476 | 3605.2 | 4766.9 | 5863.6 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| rabbitmq_queue_depth{queue:distribution} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:posts} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:shares} | `value>=0` | ✓ |
| rabbitmq_queue_total | `max>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 43,
    "shares": 201
  },
  "persistidos_final": {
    "posts": 43,
    "shares": 199,
    "feed_items": 1006,
    "shares_deduplicados": 2
  },
  "drenagem": {
    "completa": true,
    "segundos": 69,
    "segundos_total": 75,
    "pico_fila": 244,
    "pico_fila_k6": 244,
    "pico_fila_drenagem": 244,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-sync-smoke-organic-20261115T231852Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 0 | 0 | 0 | 0 |
| celebrity_share | 0 | 0 | 0 | 0 |
| feed | 728.7 | 1427.2 | 1747.2 | 1961 |
| posts_create | 1283.8 | 2619.4 | 3546.3 | 4236.8 |
| propagation_tree | 709.6 | 1399 | 1609.1 | 1753.7 |
| share | 1408.3 | 2869.4 | 3795.1 | 5936.1 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 67,
    "shares": 367
  },
  "persistidos_final": {
    "posts": 67,
    "shares": 367,
    "feed_items": 1846,
    "shares_deduplicados": 0
  },
  "drenagem": {
    "completa": true,
    "segundos": 0,
    "segundos_total": 5,
    "pico_fila": 0,
    "pico_fila_k6": 0,
    "pico_fila_drenagem": 0,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-async-smoke-organic-20261115T232826Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 0 | 0 | 0 | 0 |
| celebrity_share | 0 | 0 | 0 | 0 |
| feed | 1300.6 | 2660.7 | 3378.8 | 4291.7 |
| posts_create | 1212.6 | 2426.3 | 2527.3 | 2550.1 |
| propagation_tree | 2153 | 5926.5 | 7605 | 9812.7 |
| share | 1084.2 | 2814.2 | 4454.9 | 5967.9 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| rabbitmq_queue_depth{queue:distribution} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:posts} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:shares} | `value>=0` | ✓ |
| rabbitmq_queue_total | `max>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 34,
    "shares": 186
  },
  "persistidos_final": {
    "posts": 34,
    "shares": 184,
    "feed_items": 770,
    "shares_deduplicados": 2
  },
  "drenagem": {
    "completa": true,
    "segundos": 24,
    "segundos_total": 29,
    "pico_fila": 220,
    "pico_fila_k6": 220,
    "pico_fila_drenagem": 220,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-sync-smoke-viral_peak-20261115T233310Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 30000 | 30000.8 | 30001.1 | 30001.2 |
| celebrity_share | 30000.4 | 30001 | 30001 | 30001 |
| feed | 12.4 | 101.3 | 14215.4 | 29323.5 |
| posts_create | 22 | 30000.3 | 30000.5 | 30000.5 |
| propagation_tree | 18.3 | 505.3 | 29308.9 | 30000.9 |
| share | 21.9 | 1563.5 | 17447.5 | 30001.3 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 23,
    "shares": 81
  },
  "persistidos_final": {
    "posts": 41,
    "shares": 100,
    "feed_items": 77584,
    "shares_deduplicados": 0
  },
  "drenagem": {
    "completa": true,
    "segundos": 51,
    "segundos_total": 58,
    "pico_fila": 0,
    "pico_fila_k6": 0,
    "pico_fila_drenagem": 0,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-async-smoke-viral_peak-20261115T234429Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 465 | 1299.6 | 1612.6 | 1677.4 |
| celebrity_share | 844 | 1991.1 | 2494.1 | 3044.5 |
| feed | 440.6 | 1979.1 | 2618.2 | 3202.9 |
| posts_create | 972.2 | 2264.9 | 2532.7 | 2831.8 |
| propagation_tree | 882.2 | 3478 | 5500.4 | 6528.9 |
| share | 877.4 | 2171.1 | 2563.1 | 3000.5 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| rabbitmq_queue_depth{queue:distribution} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:posts} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:shares} | `value>=0` | ✓ |
| rabbitmq_queue_total | `max>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 240,
    "shares": 423
  },
  "persistidos_final": {
    "posts": 240,
    "shares": 413,
    "feed_items": 709605,
    "shares_deduplicados": 10
  },
  "drenagem": {
    "completa": true,
    "segundos": 400,
    "segundos_total": 405,
    "pico_fila": 663,
    "pico_fila_k6": 663,
    "pico_fila_drenagem": 662,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-sync-smoke-organic-20261116T012001Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 0 | 0 | 0 | 0 |
| celebrity_share | 0 | 0 | 0 | 0 |
| feed | 471.1 | 1539.2 | 1890.6 | 2168.7 |
| posts_create | 951.9 | 2411.9 | 2663.6 | 2885.5 |
| propagation_tree | 483.6 | 1539 | 1796 | 2175.9 |
| share | 1217.3 | 2766.9 | 3639.4 | 4330.5 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 85,
    "shares": 393
  },
  "persistidos_final": {
    "posts": 85,
    "shares": 393,
    "feed_items": 1934,
    "shares_deduplicados": 0
  },
  "drenagem": {
    "completa": true,
    "segundos": 0,
    "segundos_total": 5,
    "pico_fila": 0,
    "pico_fila_k6": 0,
    "pico_fila_drenagem": 0,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-sync-smoke-viral_peak-20261116T012356Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 30000.4 | 30000.9 | 30000.9 | 30000.9 |
| celebrity_share | 28772 | 30001 | 30001.3 | 30001.3 |
| feed | 11.9 | 12794.2 | 21855.6 | 25948.4 |
| posts_create | 18.8 | 3886.4 | 16113 | 19169.7 |
| propagation_tree | 17.6 | 352.3 | 13160.6 | 26259.3 |
| share | 22.2 | 21518.5 | 23559.3 | 24022.3 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 22,
    "shares": 80
  },
  "persistidos_final": {
    "posts": 37,
    "shares": 92,
    "feed_items": 77059,
    "shares_deduplicados": 0
  },
  "drenagem": {
    "completa": true,
    "segundos": 50,
    "segundos_total": 56,
    "pico_fila": 0,
    "pico_fila_k6": 0,
    "pico_fila_drenagem": 0,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-async-smoke-organic-20261116T013653Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 0 | 0 | 0 | 0 |
| celebrity_share | 0 | 0 | 0 | 0 |
| feed | 607.7 | 2053.7 | 2853.1 | 3807 |
| posts_create | 1140.2 | 2865.6 | 3648.6 | 4317.3 |
| propagation_tree | 1376.5 | 3396.4 | 5193.4 | 6348.9 |
| share | 1414.8 | 3410.8 | 4662.1 | 5982.6 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| rabbitmq_queue_depth{queue:distribution} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:posts} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:shares} | `value>=0` | ✓ |
| rabbitmq_queue_total | `max>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 62,
    "shares": 250
  },
  "persistidos_final": {
    "posts": 62,
    "shares": 247,
    "feed_items": 1272,
    "shares_deduplicados": 3
  },
  "drenagem": {
    "completa": true,
    "segundos": 28,
    "segundos_total": 33,
    "pico_fila": 312,
    "pico_fila_k6": 312,
    "pico_fila_drenagem": 312,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-async-smoke-viral_peak-20261116T014557Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 311.7 | 1285.4 | 1654.8 | 1751.2 |
| celebrity_share | 839.7 | 2229.5 | 2519 | 3120.3 |
| feed | 595.2 | 2430.7 | 3051.9 | 3716 |
| posts_create | 1538.3 | 2795.5 | 3404.4 | 3516.4 |
| propagation_tree | 1529.5 | 5412.3 | 6835.4 | 7893.8 |
| share | 800.2 | 2258 | 3006.5 | 4450 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| rabbitmq_queue_depth{queue:distribution} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:posts} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:shares} | `value>=0` | ✓ |
| rabbitmq_queue_total | `max>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 218,
    "shares": 372
  },
  "persistidos_final": {
    "posts": 218,
    "shares": 365,
    "feed_items": 664419,
    "shares_deduplicados": 7
  },
  "drenagem": {
    "completa": true,
    "segundos": 370,
    "segundos_total": 375,
    "pico_fila": 590,
    "pico_fila_k6": 590,
    "pico_fila_drenagem": 590,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-sync-smoke-organic-20261116T015736Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 0 | 0 | 0 | 0 |
| celebrity_share | 0 | 0 | 0 | 0 |
| feed | 574.2 | 1622.5 | 2008.3 | 2108.8 |
| posts_create | 1067.4 | 2690.7 | 3998.2 | 4159.9 |
| propagation_tree | 544.3 | 1518.5 | 1827.4 | 2029.5 |
| share | 1370.6 | 2947.9 | 3862.8 | 5059.9 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 74,
    "shares": 357
  },
  "persistidos_final": {
    "posts": 74,
    "shares": 357,
    "feed_items": 1691,
    "shares_deduplicados": 0
  },
  "drenagem": {
    "completa": true,
    "segundos": 0,
    "segundos_total": 5,
    "pico_fila": 0,
    "pico_fila_k6": 0,
    "pico_fila_drenagem": 0,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-sync-smoke-viral_peak-20261116T020127Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 29999.9 | 30000.9 | 30001.1 | 30001.2 |
| celebrity_share | 29672.5 | 30000.9 | 30001.1 | 30001.1 |
| feed | 11.6 | 14568.8 | 23998.9 | 28632.1 |
| posts_create | 19.6 | 26.4 | 27.9 | 28.3 |
| propagation_tree | 16.5 | 108.8 | 24162.1 | 25656.3 |
| share | 21.9 | 12798 | 21278.7 | 24011.8 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 15,
    "shares": 99
  },
  "persistidos_final": {
    "posts": 31,
    "shares": 108,
    "feed_items": 77330,
    "shares_deduplicados": 0
  },
  "drenagem": {
    "completa": true,
    "segundos": 50,
    "segundos_total": 58,
    "pico_fila": 0,
    "pico_fila_k6": 0,
    "pico_fila_drenagem": 0,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-async-smoke-organic-20261116T021414Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 0 | 0 | 0 | 0 |
| celebrity_share | 0 | 0 | 0 | 0 |
| feed | 637 | 1680.6 | 2377.3 | 2636.1 |
| posts_create | 675.2 | 1676.9 | 2016.2 | 2249.9 |
| propagation_tree | 1068.9 | 2937 | 3706.1 | 4466.4 |
| share | 761.2 | 1905.8 | 2715.9 | 3167.5 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| rabbitmq_queue_depth{queue:distribution} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:posts} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:shares} | `value>=0` | ✓ |
| rabbitmq_queue_total | `max>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 72,
    "shares": 353
  },
  "persistidos_final": {
    "posts": 72,
    "shares": 351,
    "feed_items": 1911,
    "shares_deduplicados": 2
  },
  "drenagem": {
    "completa": true,
    "segundos": 29,
    "segundos_total": 35,
    "pico_fila": 427,
    "pico_fila_k6": 425,
    "pico_fila_drenagem": 427,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


### viral-async-smoke-viral_peak-20261116T022315Z


| rota | p50 (ms) | p95 (ms) | p99 (ms) | máx (ms) |
| --- | --- | --- | --- | --- |
| celebrity_post | 346.2 | 950.9 | 1546.6 | 1806.8 |
| celebrity_share | 827.8 | 2409.8 | 3196.3 | 3512 |
| feed | 656 | 2713.2 | 3411.1 | 6027 |
| posts_create | 1248.1 | 3025.9 | 3429.8 | 3566.4 |
| propagation_tree | 1449.4 | 5211.7 | 6087.8 | 7588 |
| share | 794.7 | 2596.3 | 3244.9 | 3528 |


| métrica | expressão | ok |
| --- | --- | --- |
| business_ok | `rate>=0` | ✓ |
| http_5xx | `count>=0` | ✓ |
| http_req_duration{name:celebrity_post} | `p(99)>=0` | ✓ |
| http_req_duration{name:celebrity_share} | `p(99)>=0` | ✓ |
| http_req_duration{name:feed} | `p(99)>=0` | ✓ |
| http_req_duration{name:posts_create} | `p(99)>=0` | ✓ |
| http_req_duration{name:propagation_tree} | `p(99)>=0` | ✓ |
| http_req_duration{name:share} | `p(99)>=0` | ✓ |
| http_req_failed{name:celebrity_post} | `rate>=0` | ✓ |
| http_req_failed{name:celebrity_share} | `rate>=0` | ✓ |
| http_req_failed{name:feed} | `rate>=0` | ✓ |
| http_req_failed{name:posts_create} | `rate>=0` | ✓ |
| http_req_failed{name:propagation_tree} | `rate>=0` | ✓ |
| http_req_failed{name:share} | `rate>=0` | ✓ |
| http_req_failed{scenario:traffic} | `rate<0.20` | ✓ |
| http_timeouts | `count>=0` | ✓ |
| rabbitmq_queue_depth{queue:distribution} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:posts} | `value>=0` | ✓ |
| rabbitmq_queue_depth{queue:shares} | `value>=0` | ✓ |
| rabbitmq_queue_total | `max>=0` | ✓ |


```json
{
  "aceitos": {
    "posts": 201,
    "shares": 374
  },
  "persistidos_final": {
    "posts": 201,
    "shares": 366,
    "feed_items": 634025,
    "shares_deduplicados": 8
  },
  "drenagem": {
    "completa": true,
    "segundos": 374,
    "segundos_total": 379,
    "pico_fila": 602,
    "pico_fila_k6": 575,
    "pico_fila_drenagem": 602,
    "timeout_s": 900,
    "intervalo_s": 5,
    "filas_restantes": 0
  }
}
```


## Consolidação Estatística (MODE=tcc)

Agregação das repetições da bateria oficial (`scripts/run_tcc_suite.sh`, `MODE=tcc`) por cenário e arquitetura. Cada célula traz **média ± desvio-padrão amostral** das execuções do grupo; o desvio aparece como — quando há uma única amostra (N < 2). `N` é o número de execuções agregadas. As colunas de pico de fila e drenagem aplicam-se só aos cenários de viralização (— no baseline). Valores derivam apenas dos artefatos reais das execuções; grupos ou métricas sem dado exibem —.

_Ainda não há execuções registradas com `MODE=tcc`._

> Validação (`make smoke-suite`): a agregação abaixo confirma o cálculo de média ± desvio em `MODE=smoke`; os números oficiais vêm da bateria `MODE=tcc`.

## Consolidação Estatística (MODE=smoke)

Agregação das repetições da bateria oficial (`scripts/run_tcc_suite.sh`, `MODE=smoke`) por cenário e arquitetura. Cada célula traz **média ± desvio-padrão amostral** das execuções do grupo; o desvio aparece como — quando há uma única amostra (N < 2). `N` é o número de execuções agregadas. As colunas de pico de fila e drenagem aplicam-se só aos cenários de viralização (— no baseline). Valores derivam apenas dos artefatos reais das execuções; grupos ou métricas sem dado exibem —.

| cenário | arquitetura | N | req/s | p50 (ms) | p95 (ms) | p99 (ms) | erro (%) | pico fila | drenagem (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| user_lookup | async | 4 | 36.5 ± 3.5 | 1788.7 ± 214.1 | 4349.5 ± 332.6 | 5471.8 ± 491.1 | 0 ± 0 | — | — |
| user_lookup | sync | 4 | 56.2 ± 27.1 | 659.3 ± 605.6 | 4094.3 ± 3965.8 | 4360.8 ± 4074.5 | 0 ± 0 | — | — |
| viral/organic | async | 4 | 20.9 ± 5.7 | 1200 ± 365.5 | 3584 ± 1066.8 | 4975.4 ± 1464.7 | 0 ± 0 | 301 ± 93 | 43 ± 21 |
| viral/organic | sync | 4 | 37 ± 2 | 729.8 ± 90.6 | 2147.3 ± 62 | 3033 ± 110.1 | 0.05 ± 0.06 | 0 ± 0 | 5 ± 0 |
| viral/viral_peak | async | 3 | 21.4 ± 2.3 | 739.5 ± 51.7 | 3139.6 ± 611.5 | 4845.4 ± 1073.9 | 0 ± 0 | 618 ± 39 | 386 ± 16 |
| viral/viral_peak | sync | 3 | 5.2 ± 0.5 | 18 ± 0.9 | 29747.7 ± 437.6 | 30000.9 ± 0.1 | 6.84 ± 1.69 | 0 ± 0 | 57 ± 1 |


## Comparações observadas (sync × async)

Apenas números das execuções listadas acima, sem interpretação. As colunas de pico de fila e drenagem aplicam-se só aos cenários de viralização (— no baseline).

| configuração | req/s sync | req/s async | p50 sync | p50 async | p95 sync | p95 async | p99 sync | p99 async | falha sync | falha async | pico fila sync | pico fila async | drenagem sync (s) | drenagem async (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline/user_lookup — smoke — 80 VUs | 74.3 | 36.6 | 91.8 | 1739.3 | 2288.2 | 4402.6 | 2492.4 | 5603.3 | 0 | 0 | — | — | — | — |
| viral/organic — smoke — 50 VUs | 36.5 | 28.7 | 707.9 | 768.4 | 2113.9 | 2273.5 | 3098.1 | 3187.3 | 0.001 | 0 | 0 | 427 | 5 | 35 |
| viral/viral_peak — smoke — 50 VUs | 5.9 | 19.9 | 17.5 | 771.7 | 29242.3 | 3497 | 30000.8 | 5338.2 | 0.052 | 0 | 0 | 602 | 58 | 379 |

