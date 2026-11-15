# Resultados dos experimentos

> **Documento gerado automaticamente por `scripts/resultados.py` a partir de
> `code/k6/results/`. Não editar manualmente.** Todos os números abaixo provêm de execuções
> reais realizadas neste repositório; estimativas e números não coletados não são impressos.
> A interpretação, as comparações conclusivas e as conclusões pertencem à monografia.

- Execuções registradas: 4 (baseline: 4, viralização: 0).
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


## Viralização (viral.js)

_Ainda não há execuções registradas._


## Comparações observadas (sync × async)

Apenas números das execuções listadas acima, sem interpretação.

| configuração | req/s sync | req/s async | p50 sync | p50 async | p95 sync | p95 async | p99 sync | p99 async | falha sync | falha async |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline/user_lookup — smoke — 80 VUs | 65.2 | 37 | 1070.3 | 1700.3 | 1765.5 | 4399.3 | 1995.6 | 5610.8 | 0 | 0 |

