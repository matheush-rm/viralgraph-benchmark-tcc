# Cenários de teste de desempenho

Índice comparativo dos cenários de carga do TCC. Cada cenário tem um documento dedicado com o
procedimento completo; este arquivo organiza o conjunto e mostra onde cada um entra na
comparação entre as duas composições arquiteturais (Laravel/PHP-FPM/MySQL síncrono ×
Hyperf/Swoole/RabbitMQ/Neo4j assíncrono). **Nenhum cenário contém resultados aqui**; os números
coletados ficam em [resultados.md](resultados.md), gerado a partir de execuções reais.

## Visão geral

| | Baseline (controle) | Viralização |
| --- | --- | --- |
| Documento | [baseline-user-lookup.md](baseline-user-lookup.md) | [viralizacao.md](viralizacao.md) |
| Script k6 | `code/k6/baseline_user_lookup.js` | `code/k6/viral.js` |
| Finalidade | linha de base da leitura pontual de perfil sob concorrência | degradação sob escrita com fan-out e cascatas de compartilhamento |
| Rotas | `GET /usuarios/{id}` | `GET /feed/:id`, `GET /posts/:id/propagation-tree` (até 4 níveis), `POST /posts`, `POST /posts/:id/share` |
| Leituras/escritas | só leitura | leituras + escritas (conforme a mistura) |
| Massa | snapshot seed 42 (10.020 usuários; hot set de 500, Pareto 80/20) | snapshot seed 42 (grafo Zipf: cascatas, feed, celebridades) |
| Perfis de carga | `MODE=smoke` (80 VUs, ~40 s) e `MODE=tcc` (100→400→600 VUs, ~5 min) | `MODE=smoke` (50 VUs, 30 s) e `MODE=tcc` (rampa até `VUS_MAX`, 3 min por mistura) |
| Modo de acesso aos IDs | Pareto 80/20 (hot/cold) | Zipf sobre posts virais; usuários uniformes |
| Métricas próprias | `contract_errors`, `user_lookups{set}` | `business_ok`, `share_duplicates`, `rabbitmq_queue_depth` |
| Targets Makefile | `baseline-smoke-sync`, `baseline-smoke-async`, `baseline-tcc-sync`, `baseline-tcc-async` | `viral-load`, `viral-tcc`, `viral-tcc-all`, `viral-tcc-levels` (com `SCENARIO=...`); cenários finais `viral-organic-{sync,async}`, `viral-peak-{sync,async}` |

Os dois cenários compartilham o mesmo dataset determinístico (seed 42), o mesmo snapshot de
volumes, o mesmo orçamento de recursos por composição e a mesma observabilidade (Prometheus +
Grafana + cAdvisor). Cada execução restaura o snapshot antes da carga.

## Baseline (controle)

`GET /usuarios/{id}` sob alta concorrência, sem escrita. Define quanto custa ler um perfil de
perfil — inclusive para os nós de maior centralidade de grafo (celebridades) — sem nenhum
trabalho de distribuição. É a referência para separar, na degradação observada no cenário viral,
o que vem do caminho de leitura e o que vem do fan-out/cascatas. Valida o schema `Usuario` campo
a campo (`contract_errors = 0`). Detalhes, limites e execução em
[baseline-user-lookup.md](baseline-user-lookup.md).

## Viralização

Escrita e leitura sobre o snapshot Zipf, com fan-out na escrita de posts e compartilhamentos em
cascata. A rota `GET /posts/:id/propagation-tree` devolve a árvore de propagação em até 4 níveis
(`[:RESHARED_FROM*1..4]` no Neo4j; CTE recursiva no MySQL) e é exercitada **apenas aqui** — no
baseline ela fica de fora de propósito. O `viral.js` seleciona a mistura por iteração com
`SCENARIO=`:

| `SCENARIO` | Mistura | Finalidade |
| --- | --- | --- |
| `baseline` | 80% feed de comum \| 20% escrita de comuns (metade post, metade share) | piso sem celebridade: escrita comum + leitura de feed |
| `fanout` | 80% celebridades (metade post, metade share; fan-out 2000+) \| 20% feed de comum | estresse de fan-out puro |
| `graph_read` | 90% árvore de propagação de post viral \| 10% feed de comum | leitura de grafo (travessia) |
| `mixed` | 70% leitura (feed/árvore) \| 25% escrita de comuns \| 5% celebridade | carga mista de referência |
| `organic` | 70% leitura (feed/árvore) \| 30% escrita de comuns na razão 25:5 (share:post), sem celebridade | crescimento orgânico sem pico de centralidade; rampa suave de usuários comuns |
| `viral_peak` | cascata em fases, com a mistura variando pelo tempo decorrido: aquecimento (comuns + leitura), pico de centralidade (celebridade + compartilhamento/árvore), platô (escrita+leitura com celebridade) e resfriamento (só leitura leve) | efeito manada a partir de nós de alta centralidade de grau, com ascensão, saturação e drenagem |

Atenção à nomenclatura: o `SCENARIO=baseline` do `viral.js` é uma **mistura de carga do cenário
de viralização** (feed + escrita comum); o **baseline de busca de perfil** é outro cenário, com
script e targets próprios (`baseline_user_lookup.js`), que só consulta `GET /usuarios/{id}`.

Os cenários `organic` e `viral_peak` usam executor `ramping-vus` com rampa própria, cujo pico de
VUs é fixo (50 no `smoke`, 300 no `tcc`) e independente de `VUS_MAX`. No `viral_peak`, a mistura
não é constante: cada iteração consulta o tempo decorrido da carga (`exec.scenario.startTime`) e
seleciona a fase correspondente (aquecimento, pico de centralidade, platô e resfriamento), cujos
limites derivam das durações das stages do `MODE` corrente. As ações recebem rótulos por fase em
`actions{kind}` (`warmup`, `peak_celebrity`, `cascade`, `plateau`, `cooldown`), registrados no
`output.log`. Os targets `viral-organic-{sync,async}` e `viral-peak-{sync,async}` restauram o
snapshot limpo antes de cada rodada.

Procedimento, dataset, snapshot, drenagem e limitações em [viralizacao.md](viralizacao.md).
As contagens `aceitos × persistidos` e a auditoria de dedup de compartilhamentos ficam em
`contagens.json` por execução.

## Registro histórico

O perfil de chegadas da Rinha 2023 Q3 (`code/k6/stress.js` coordenado por `code/k6/run.py`:
cenários `reference`, `fanout`, `cascade`, `growth`) antecede os cenários acima. Ele está
documentado em [teste-estresse.md](teste-estresse.md) e [code/k6/README.md](../k6/README.md) e
não é coletado pelo pipeline atual de snapshot/carga.

## Execução e resultados

```bash
make viral-dataset                       # gera o dataset seed 42 (uma vez)
bash scripts/viral.sh snapshot sync      # snapshot MySQL (uma vez)
bash scripts/viral.sh snapshot async     # snapshot Neo4j (uma vez)
bash scripts/viral.sh obs up             # Prometheus :9090, Grafana :3000, cAdvisor :8088

make baseline-smoke-sync                 # controle × composição síncrona
make baseline-smoke-async                # controle × composição assíncrona
make viral-load SCENARIO=mixed           # viralização (MODE=smoke por padrão)

make resultados                          # regenera code/docs/resultados.md
```

Execute uma arquitetura por vez (as duas disputam a CPU do host) e não use a máquina para
outras cargas durante as coletas oficiais (`MODE=tcc`).

## Bateria oficial e rastreamento distribuído

A coleta oficial com repetições estatísticas é orquestrada por `scripts/run_tcc_suite.sh`, que
repete os três cenários finais (baseline de busca de perfil, `organic` e `viral_peak`) nas duas
composições, restaurando o snapshot limpo antes de cada repetição:

```bash
make tcc-suite        # REPS=3, MODE=tcc (coleta oficial)
make smoke-suite      # REPS=2, MODE=smoke (valida o fluxo)
make resultados       # consolida as repetições (seção "Consolidação Estatística (MODE=tcc)")
make trace-evidence   # rodada única OTEL_ENABLED=1 para a evidência no Jaeger (UI :16686)
```

A bateria estatística roda com o OpenTelemetry desligado (métricas de desempenho sem o custo da
instrumentação); o rastreamento distribuído (OpenTelemetry + Jaeger, fora do orçamento de recursos)
é coletado numa rodada separada com `make trace-evidence`. Procedimento, decisões de amostragem e
propagação W3C em [viralizacao.md](viralizacao.md).
