# Cenário de viralização: dataset Zipf, snapshot e carga k6

Roteiro de execução do teste que compara as duas composições sob compartilhamentos em cascata e picos de fan-out de celebridades. Este documento descreve o procedimento; **não contém resultados**. Os números de smoke citados abaixo servem apenas para mostrar que o fluxo funciona e não devem ser usados no artigo. O cenário de controle de leitura (`GET /usuarios/{id}`, sem escrita) é descrito em [baseline-user-lookup.md](baseline-user-lookup.md); a visão comparativa de todos os cenários fica em [cenarios.md](cenarios.md), e os números coletados, em [resultados.md](resultados.md).

## Endpoints exercitados

| Rota | Laravel + MySQL (síncrono) | Hyperf + RabbitMQ + Neo4j (assíncrono) |
| --- | --- | --- |
| `POST /posts/:id/share` | `201`; registro + fan-out aos seguidores na mesma transação, `INSERT IGNORE` em lotes de 500 | `202` após confirmação do RabbitMQ; consumer em corrotina (prefetch 50) grava o lote com `UNWIND` numa transação |
| `GET /posts/:id/propagation-tree` | CTE recursiva (`WITH RECURSIVE`), índice `shares(post_id, source_user_id)`, `LIMIT 501` | Ancorada em `(:Post {id})` + autor; caminho variável `[:RESHARED_FROM*1..4 {post_id}]`, `ORDER BY`/`LIMIT 501` antes de montar o payload; índice `reshared_post_id` |
| `GET /feed/:usuario_id` | Feed materializado (`feed_items`) | Feed materializado (`(:User)-[:FEED]->(:Post)`) |
| `POST /posts` | Fan-out síncrono | Fila `posts` → outbox → fila `distribution` |

O feed contém posts dos seguidos e posts compartilhados pelos seguidos (segundo grau), com uma entrada por `(usuário, post)`; `origem` vale `post` ou `share` nas duas arquiteturas. A árvore retorna até 500 arestas (`truncado` indica corte). O compartilhamento valida usuário, post e origem (autor ou compartilhador), mas não exige o post no feed: no assíncrono o feed é eventualmente consistente e a exigência geraria falsos negativos sob carga. Regras completas em [contrato-api.md](contrato-api.md).

## Dataset (`code/dataset/generate.py`)

Determinístico por seed (padrão 42). Parâmetros padrão:

- 10.000 usuários comuns com número de seguidores em Zipf truncada `P(k) ∝ k^-1` para `k ∈ [1, 30]`;
- 20 celebridades com `2000 + 3000/rank` seguidores (5000 no rank 1 até 2150 no rank 20);
- seguidores sempre sorteados entre usuários comuns;
- 5 posts por celebridade, 0–3 por usuário comum; 150 posts virais (todos os das celebridades e 50 de comuns);
- cascatas por BFS a partir do autor, até 6 níveis (a árvore da API corta em 4), com probabilidade de compartilhar 3% (seguidor de celebridade), 25% (seguidor de comum) e 12% nos níveis seguintes;
- feed materializado em ordem cronológica, uma entrada por `(destinatário, post)`.

Contagens da seed 42 (de `manifest.json`): 10.020 usuários, 126.323 relações de seguir, 15.003 posts, 34.297 compartilhamentos, 532.820 entradas de feed. A distribuição observada fica em `manifest.json`.

Saídas em `code/dataset/out/` (ignorado pelo Git):

| Arquivo | Uso |
| --- | --- |
| `mysql/seed.sql.gz` | `INSERT` multi-linha, aplicado após `php artisan migrate` |
| `neo4j/*.csv.gz` + `neo4j/schema.cypher` | `neo4j-admin database import full` (offline) e, depois, constraints/índices |
| `k6/dataset.json` | IDs para a carga: comuns, celebridades, posts virais e candidatos válidos a compartilhar (usuário que tem o post no feed + quem o entregou) |

O Neo4j usa importação offline porque aplicar o mesmo volume por `UNWIND` via `cypher-shell`, com o Neo4j limitado a 0,5 CPU, levou vários minutos para poucos milhares de relações (medição informal durante o desenvolvimento).

## Snapshot de volumes

```bash
scripts/viral.sh dataset          # ~20 s
scripts/viral.sh snapshot sync    # migrations + seed.sql; salva o volume MySQL em tar
scripts/viral.sh snapshot async   # neo4j-admin import + schema; salva o volume Neo4j em tar
scripts/viral.sh restore sync     # recria o volume a partir do tar e sobe o ambiente
scripts/viral.sh restore async
```

A geração do snapshot é feita uma vez. Na máquina de desenvolvimento ⚠️ (inferred: tempos de uma única execução, variam com disco e CPU): MySQL ~10 min (1 CPU), Neo4j ~1,5 min (import em ~10 s). A restauração do volume levou 2–11 s; o ambiente fica pronto em ~35 s (sync) e ~80 s (async), tempo dominado pela inicialização do Neo4j e pelos intervalos de healthcheck. O alvo de ~3 s vale para a cópia do volume, não para a subida completa.

`restore` e `down` removem os volumes **somente** dos projetos `tcc-viral-sync` e `tcc-viral-async`. Cada `restore` volta exatamente ao estado do snapshot; execute-o antes de cada repetição.

## Carga k6 (`code/k6/viral.js`)

```bash
scripts/viral.sh obs up                       # Prometheus :9090, Grafana :3000, cAdvisor :8088
MODE=smoke scripts/viral.sh load sync         # 30 s, 50 VUs (SCENARIO padrão: mixed)
make viral-tcc VIRAL_ARCH=async SCENARIO=fanout   # restore do snapshot + warmup + MODE=tcc (3 min)
make viral-tcc-all VIRAL_ARCH=sync                # os 4 cenários, restore limpo antes de cada um
make viral-tcc-levels VIRAL_ARCH=sync             # um cenário em cada degrau (VIRAL_LEVELS=20 600)
make viral-organic-async                          # cenário organic (restore limpo; MODE=smoke por padrão)
make viral-peak-async                             # cenário viral_peak (restore limpo; MODE=smoke por padrão)
scripts/viral.sh counts async                     # contagens direto no banco, a qualquer momento
```

`SCENARIO` seleciona a mistura por iteração:

| Cenário | Mistura |
| --- | --- |
| `baseline` | 80% `GET /feed/:id` de comum; 20% escrita de comuns (metade `POST /posts`, metade `POST /posts/:id/share` com candidato válido) |
| `fanout` | 80% ações de celebridades (metade `POST /posts`, metade `POST /posts/:id/share` de post viral alheio, origem = autor); 20% `GET /feed/:id` de comum |
| `graph_read` | 90% `GET /posts/:id/propagation-tree` de post viral (Zipf `s=1,1` sobre o ranking de cascatas); 10% `GET /feed/:id` |
| `mixed` (padrão) | 70% leitura (metade feed, metade árvore); 25% escrita de comuns; 5% celebridade (metade post, metade share) |
| `organic` | 70% leitura (metade feed, metade árvore); 30% escrita de comuns na razão 25:5 (share : `POST /posts` comum). Sem celebridade. |
| `viral_peak` | cascata em fases; a mistura varia pelo tempo decorrido da carga (ver abaixo) |

Celebridades não seguem ninguém no dataset, então não têm posts no feed; no `fanout` e no `mixed` compartilham post viral de outro autor sorteado uniformemente do pool global de posts virais do snapshot com origem = autor (a API não exige o post no feed, só origem válida), gerando fan-out para seus 2000+ seguidores. Cada par (celebridade, post) só vale uma vez (20 × ~150 pares); repetições retornam 422 e são contadas em `share_duplicates`, o que tende a crescer ao longo do `fanout`.

`MODE=tcc` dura 3 min: `VUS_MAX/2` (30 s) → `VUS_MAX` (30 s) → patamar (1m30) → 0 (30 s). Variáveis: `VUS_MAX` (degrau de carga, ver abaixo), `THINK_MIN_MS`/`THINK_MAX_MS` (padrão 50–250 ms), `ZIPF_S`. Resultados ficam em `code/k6/results/viral-<arch>-<mode>-<cenário>[-vus<N>]-<timestamp>/` (o sufixo `-vus<N>` aparece só no `MODE=tcc`); as séries do Prometheus recebem as tags `experiment=<cenário>` e `vus_max=<N>`.

### Cenários `organic` e `viral_peak`

Os cenários `organic` e `viral_peak` usam executor `ramping-vus` próprio, com pico de VUs fixo (50 no `smoke`, 300 no `tcc`) e independente de `VUS_MAX`. Reaproveitam os mesmos arrays do dataset (`common_users`, `celebrities`, `viral_posts`), sem regeração.

- `organic` sobe a 50 VUs em duas stages no `smoke` (~40 s) e, no `tcc`, ramifica 150 → 300 → 300 (patamar) → 0 (~5 min). A mistura é fixa: 70% leitura e 30% escrita de comuns, com o share respondendo por 25 das 30 partes de escrita e o `POST /posts` comum pelas 5 restantes. Nenhuma ação de celebridade é alcançável, o que isola o crescimento orgânico do efeito de centralidade.
- `viral_peak` encadeia cinco stages (`smoke` ~55 s; `tcc` ~6 min) agrupadas em quatro fases. A cada iteração o script calcula o tempo decorrido da carga por `exec.scenario.startTime` e seleciona a fase pelos limites cumulativos derivados das durações das stages do `MODE` corrente (sem números duplicados):

  | Fase | Rótulo `actions{kind}` | Mistura |
  | --- | --- | --- |
  | Aquecimento | `warmup` | usuários comuns + leitura (feed/árvore); sem celebridade |
  | Pico de centralidade | `peak_celebrity`, `cascade` | ações de celebridade concentradas + compartilhamento válido e leitura de árvore/feed (cascata limitada a 4 gerações pela API) |
  | Platô de saturação | `plateau` | escrita e leitura altas sustentadas, com peso de celebridade (tipo `mixed`) |
  | Resfriamento | `cooldown` | só leitura leve (feed/árvore); abrange as duas últimas stages (queda rápida e sustentação) |

A sonda de fila (`scenarios.queue`) tem a duração ajustada para cobrir toda a janela de carga de cada cenário e modo, sem encerrar antes dela.

### Degraus de carga

Os resultados são separados em dois degraus, cada um sobre snapshot restaurado:

| Degrau | `VUS_MAX` | Finalidade |
| --- | --- | --- |
| Moderado | 20 | Carga em que a composição síncrona ainda responde às rotas de usuários comuns dentro do timeout do k6, permitindo comparar a latência efetiva das duas composições. |
| Estresse viral | 600 | Saturação: mostra como cada composição degrada (timeouts no síncrono, acúmulo de filas no assíncrono). |

`VIRAL_LEVELS` altera a lista usada por `make viral-tcc-levels`.

#### Escolha do degrau moderado (rampa exploratória)

Critério: maior `VUS_MAX` em que o síncrono fica abaixo de 1% de requisições falhas (timeout do k6 de 30 s ou 5xx) nas **rotas de usuários comuns** (`feed`, `propagation_tree`, `posts_create`, `share`). As ações de celebridade (`celebrity_post`, `celebrity_share`) ficam fora do critério porque estouram o timeout em todos os degraus medidos, inclusive com 10 VUs: o limiar original (~1% de `http_timeouts` no total) não era atingível em nenhum degrau, por um efeito do fan-out de celebridade e não do nível de carga. Valor anterior: 150 VUs (assumed, não medido), que saturava o síncrono (60% de falhas).

Rampa de 2026-11-14 (`MODE=tcc`, `SCENARIO=mixed`, snapshot restaurado e warmup antes de cada degrau; uma execução por degrau, na máquina de desenvolvimento). Células: taxa de falha / p95.

| `VUS_MAX` | feed | árvore | post comum | share comum | post celebridade | share celebridade | req/s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | 0% / 4,6 s | 0% / 3,2 s | 0% / 8,6 s | 0% / 8,4 s | 14,2% / 30 s | 36,3% / 30 s | 3,7 |
| 15 | 0% / 9,8 s | 0% / 7 s | 0% / 9 s | 0% / 8 s | 35,2% / 30 s | 29,1% / 30 s | 3,9 |
| **20** | 0% / 12,4 s | 0% / 13 s | 0% / 11 s | 0% / 13 s | 28,5% / 30 s | 35,2% / 30 s | 3,6 |
| 25 | 0% / 16,4 s | 0% / 12 s | 0,9% / 13 s | 0,8% / 20 s | 15% / 30 s | 38% / 30 s | 4,1 |
| 50 | 29,2% / 30 s | 23,2% / 30 s | 26,8% / 30 s | 30,4% / 30 s | 59% / 30 s | 77,2% / 30 s | 3,1 |
| 100 | colapso: 50,8% de timeouts no total | | | | | | 3,7 |

Escolhido 20: maior degrau sem nenhuma falha nas rotas comuns. Com 25 elas começam a falhar e com 50 todas colapsam. Mesmo no degrau moderado o p95 das rotas comuns fica entre 11 e 13 s: "moderado" significa que o síncrono ainda responde, não que responde rápido.

Observações da rampa (não são resultados do TCC; servem só para calibrar a carga):

- A vazão do síncrono ficou entre ~3 e 4 req/s em todos os degraus. Como o modelo é fechado (cada VU espera a resposta antes da próxima requisição), mais VUs aumentam a latência, não a vazão.
- ⚠️ Inferred — not documented: cada post ou share de celebridade grava de 2000 a 5000 entradas de feed numa transação só; com escritas concorrentes, isso passa dos 30 s. Causa não investigada (locks do InnoDB, `pm.max_children` do PHP-FPM e limite de CPU do MySQL são candidatos).
- Valores de uma única execução por degrau; variam com o host. Refazer a rampa se o host, os limites de CPU/memória ou o dataset mudarem.

Métricas expostas:

- resumo do k6 (`code/k6/results/viral-*/summary.json` e `output.log`): p50/p95/p99 e taxa de erro por rota (`name`), `http_5xx`, `http_timeouts`, `share_duplicates`;
- `rabbitmq_queue_depth{queue}` (async): amostrado pelo k6 a cada 1 s no endpoint Prometheus do RabbitMQ;
- `rabbitmq_queue_total` (async, Trend): soma de todas as filas por amostra de 1 s; o `max` no `summary.json` é o pico de fila observado pelo k6, usado em `contagens.json`;
- Prometheus/Grafana (dashboard "TCC - Viralização"): séries `k6_*` via remote write, `rabbitmq_queue_messages`, CPU/memória por container (cAdvisor);
- `contagens.json`: aceitos × persistidos, lidos direto no banco (seção seguinte).

O smoke reprova somente se 20% ou mais das requisições falharem (`http_req_failed{scenario:traffic}`), pois 50 VUs com share de celebridade já saturam as duas composições (503 por timeout do Neo4j; deadlock 1213 e timeout no MySQL). Ele valida a integridade do fluxo, a coleta no Prometheus e a geração de `contagens.json`, não desempenho. Latência alta e timeouts sob saturação são resultado do experimento, não falha do teste. Na composição assíncrona, uma consulta Neo4j acima de `NEO4J_TIMEOUT_MS` (10 s no benchmark) vira `503`, então a saturação aparece como 5xx; na síncrona aparece como latência ou timeout do k6 (30 s). Essa diferença precisa ser considerada ao comparar taxas de erro.

## Aceitação × conclusão

As duas composições confirmam coisas diferentes ao responder 2xx, e o resumo do k6 mede só a resposta. Por isso o script registra três quantidades distintas:

| Quantidade | Origem | Síncrona (Laravel + MySQL) | Assíncrona (Hyperf + RabbitMQ + Neo4j) |
| --- | --- | --- | --- |
| **Aceitos** | respostas 2xx vistas pelo k6 (`summary.json`) | 201 = transação confirmada: post/share e fan-out no feed gravados antes da resposta | `POST /posts` 201 e share 202 = evento confirmado pelo broker; persistência e fan-out ainda não ocorreram |
| **Persistidos ao fim da carga** | `COUNT` no banco quando o k6 termina | ≈ aceitos, mais requisições que o k6 abandonou por timeout e que o PHP-FPM ainda concluiu ⚠️ (inferred) | parte dos aceitos; o restante está nas filas ou na outbox (`Task.done=false`) |
| **Persistidos após drenagem** | `COUNT` após filas e outbox vazias e contagens estáveis | igual ao anterior, salvo gravações tardias | aceitos menos duplicatas descartadas pelo consumer |

Consequências para a análise:

- Taxa de erro HTTP baixa no assíncrono não significa trabalho concluído. Uma comparação justa usa a latência de **aceitação** (k6) junto com o **tempo de drenagem** (`drenagem.segundos`), que mede quanto o sistema leva para tornar visível o que já aceitou.
- No síncrono, `http_timeouts` não equivale a perda de escrita: a requisição pode ter sido gravada depois que o k6 desistiu. A diferença entre persistidos e aceitos quantifica esse efeito.
- No assíncrono, shares duplicados ainda na fila recebem 202 e são descartados pelo consumer (`SHARED.key` é único), então persistidos podem ficar abaixo de aceitos sem que haja falha. O worker grava cada descarte como `(:ShareDuplicate {id})` (id da mensagem) na mesma transação do lote; o MERGE por id mantém a contagem exata mesmo quando o cliente Neo4j desiste por timeout, o commit ocorre no servidor e o lote é reenviado e registra `shares: lote=… deduplicados=…` no log; `/metricas` expõe o total como `compartilhamentos_deduplicados`. Após drenagem completa espera-se `aceitos.shares − persistidos_final.shares_deduplicados = persistidos_final.shares`.
- Divergência de contrato: no Hyperf, `POST /posts` responde 201, embora só confirme a publicação no broker, como o share (202). A semântica efetiva é de aceitação.

### `contagens.json`

Gravado por `scripts/viral.sh load` em cada execução. As contagens vêm do banco (`COUNT(*)` no MySQL via `docker compose exec`; consulta Cypher pela API HTTP do Neo4j via `wget` dentro do container), e não de `/metricas`, que pode não responder com a API ainda saturada. A contagem inicial é feita após o aquecimento (só leitura), imediatamente antes da carga.

| Campo | Conteúdo |
| --- | --- |
| `aceitos.posts` | sucessos de `posts_create` + `celebrity_post` |
| `aceitos.shares` | sucessos de `share` + `celebrity_share` menos `share_duplicates` (422) |
| `inicio`, `fim_carga`, `final` | `posts`, `shares`, `feed_items`, `tarefas_pendentes` (outbox; sempre 0 no síncrono) e `shares_deduplicados` (ver abaixo) |
| `persistidos_fim_carga`, `persistidos_final` | diferença em relação a `inicio` |
| `drenagem` | `completa`, `segundos` (do fim da carga à primeira leitura estável), `segundos_total` (do fim da carga à condição completa de parada; `null` em timeout), `pico_fila` (= `max(pico_fila_k6, pico_fila_drenagem)`), `pico_fila_k6` (max do Trend `rabbitmq_queue_total`), `pico_fila_drenagem` (max observado durante a espera), `timeout_s`, `intervalo_s`, `filas_restantes` |

A drenagem termina quando as filas do RabbitMQ (prontas + sem ack) e a outbox estão vazias e duas leituras seguidas coincidem, ou ao atingir `DRAIN_TIMEOUT_S` (padrão 900 s, também em `make`). `DRAIN_POLL_S` (padrão 5 s) define o intervalo e a resolução do tempo medido. Com `completa=false`, `final` traz a última leitura e `segundos` fica nulo. A condição completa de parada não muda; a espera passou a registrar também `pico_fila_drenagem` (maior profundidade de fila observada) e `segundos_total` (tempo total até a parada completa, nulo em timeout). O pico de fila reportado em `pico_fila` combina essa medida com o pico do k6 (`pico_fila_k6`, lido de `rabbitmq_queue_total`), tomando o maior dos dois. No síncrono não há fila nem sonda, logo `pico_fila`, `pico_fila_k6` e `pico_fila_drenagem` ficam em 0 de forma coerente.

## Limitações conhecidas

- Execute uma arquitetura por vez: as duas compartilham a CPU do host.
- O 2xx do Hyperf não garante persistência; `contagens.json` (após drenagem) indica o que foi efetivamente gravado.
- As leituras de drenagem rodam enquanto os workers ainda processam e disputam o mesmo host; o custo é pequeno (uma consulta de contagem por intervalo), mas não é nulo.
- A validação do compartilhamento assíncrono usa o estado já persistido: duplicatas ainda na fila podem receber 202, e o consumer descarta a repetição.
- O cAdvisor precisa da v0.55+ com o image store do containerd no Docker; a v0.52 não identificava os containers.

## Bateria oficial de repetições (`MODE=tcc`)

A coleta oficial roda por `scripts/run_tcc_suite.sh`, que repete os três cenários finais (baseline
de busca de perfil, `organic` e `viral_peak`) nas duas composições, restaurando o snapshot limpo
antes de **cada** repetição (`scripts/viral.sh restore`, que já sobe com `up --wait`, portanto
espera os healthchecks). As repetições reaproveitam os comandos existentes: o baseline usa
`scripts/viral.sh baseline`; `organic` e `viral_peak` usam `scripts/viral.sh load` com `SCENARIO`.

```bash
bash scripts/viral.sh obs up         # Prometheus, Grafana, cAdvisor (e Jaeger, fora do orçamento)
make tcc-suite                       # REPS=3, MODE=tcc, cenários × arquiteturas
make smoke-suite                     # REPS=2, MODE=smoke (valida o fluxo, não é coleta oficial)
make resultados                      # consolida as repetições em code/docs/resultados.md
DRY_RUN=1 bash scripts/run_tcc_suite.sh   # imprime o plano sem executar
```

Variáveis: `REPS` (padrão 3), `MODE` (padrão `tcc`), `ARCHS` (padrão `sync async`) e `SCENARIOS`
(padrão `baseline organic viral_peak`) permitem rodar subconjuntos. Cada passo (restore, baseline,
load) tem o código de retorno capturado sem abortar a bateria; o log consolidado e o índice de
`rc` por amostra ficam em `code/k6/results/suite-logs/`. O relatório ganha a seção **Consolidação
Estatística (MODE=tcc)**, com média ± desvio-padrão amostral (desvio = — quando N < 2) de req/s,
p50, p95, p99, taxa de erro (%), pico de fila e drenagem (s) por grupo `(cenário, arquitetura)`,
além de `N`. Nada é inventado: métricas ausentes numa execução não entram na amostra.

A bateria estatística roda com o **OpenTelemetry desligado** (`OTEL_SDK_DISABLED=true` e amostragem
0), para que o custo da instrumentação não distorça as métricas de desempenho. O rastreamento é
coletado à parte (próxima seção).

## Rastreamento distribuído (OpenTelemetry + Jaeger)

A evidência de rastreamento distribuído é coletada numa rodada **única e separada**, com o
OpenTelemetry ligado:

```bash
bash scripts/viral.sh obs up                          # sobe também o Jaeger (UI :16686)
make trace-evidence                                   # rodada única OTEL_ENABLED=1 (async/viral_peak)
make trace-evidence TRACE_ARCH=sync TRACE_SCENARIO=organic   # outra combinação
```

Componentes e decisões:

- **Backend OTLP**: Jaeger all-in-one (`observability/compose.yaml`), `COLLECTOR_OTLP_ENABLED=true`,
  OTLP gRPC 4317 e HTTP 4318, UI em `http://127.0.0.1:16686`. Roda em `network_mode: host` e **fora
  do orçamento** de 1,5 CPU / 3 GB das arquiteturas; só é necessário na rodada de trace.
- **SDK**: `open-telemetry/sdk` + `open-telemetry/exporter-otlp` via Composer, sem a extensão C. Os
  containers do SUT alcançam o Jaeger por `host.docker.internal:4318` (`extra_hosts`
  `host.docker.internal:host-gateway` nos compose, sem tocar nos limites de recurso).
- **Amostragem**: `traceidratio` com `OTEL_TRACES_SAMPLER_ARG=0.02` (2% dos traces), para registrar
  o fluxo sem sobrecarregar o caminho quente.
- **Custo zero quando desligado**: com `OTEL_ENABLED != 1` toda a instrumentação é no-op (um
  `Telemetry` que retorna antes de tocar o SDK), então a bateria estatística não paga nada.
- **Composição síncrona**: span server de `POST /posts/{id}/share` em
  `app/Services/ShareService.php::create`, englobando a transação MySQL e o fan-out em chunks. O
  PHP-FPM é por requisição; o `TracerProvider` é montado sob demanda e só quando habilitado.
- **Composição assíncrona**: o `TracerProvider` é montado **uma vez por processo** no bootstrap
  (`bin/hyperf.php` e `bin/worker.php`), não por requisição, porque o Swoole é de longa duração.
  Há um span server em `app/Service/ShareService.php::accept`; o traceparent W3C é injetado nos
  headers AMQP em `app/Infrastructure/RabbitMQ/Broker.php::publish` e extraído de cada mensagem no
  worker. Como um lote agrega mensagens de traces diferentes, o span do lote (UNWIND no Neo4j em
  `ShareBatchProcessor`) usa **span links** para cada traceparent de origem, em vez de forjar uma
  única hierarquia pai-filho (`inject`/`extract` manuais, propagação W3C).
