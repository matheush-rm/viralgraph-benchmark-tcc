# Baseline (controle): busca de perfil de usuário por ID sob alta concorrência

Cenário de controle do TCC. Enquanto o [cenário de viralização](viralizacao.md) exercita escrita
com cascata de compartilhamento e fan-out, este cenário isola **uma única rota de leitura**,
`GET /usuarios/{id}`, e mede o caminho pontual de consulta de perfil sob alta concorrência.
Os resultados servem de linha de base para atribuir a degradação observada no cenário viral ao
trabalho de distribuição (fan-out/cascatas), e não ao custo da leitura de perfil em si.

Este documento descreve o procedimento; **não contém resultados**. Os números coletados ficam em
[resultados.md](resultados.md), gerado automaticamente a partir de `code/k6/results/`.

## Rota exercitada e contrato

`GET /usuarios/{id}` — operação `consultarUsuario` de [openapi.yaml](openapi.yaml). Resposta `200`
com o schema `Usuario`, todos os campos obrigatórios:

| Campo | Tipo | Restrição |
| --- | --- | --- |
| `id` | string UUID | igual ao ID requisitado |
| `nome` | string | 1–32 pontos de código, não vazia |
| `apelido` | string | 1–100 pontos de código, não vazia |
| `nascimento` | string | data `AAAA-MM-DD` |

`404` para ID inexistente e `422` para UUID malformado fazem parte do contrato, mas o cenário
só requisita IDs válidos do dataset: qualquer status diferente de `200` conta como falha
(`http_req_failed`), e qualquer violação de corpo conta como `contract_errors`.

**Escopo:** a [rota de propagação em 4 níveis](contrato-api.md#árvore-de-propagação)
(`GET /posts/:id/propagation-tree`) **não** entra neste cenário. Ela continua sendo exercitada
apenas pelo cenário de viralização, que é onde a topologia de cascata existe.

## Massa de dados (dataset seed 42)

O cenário usa os **10.020 usuários determinísticos** gerados por
[`code/dataset/generate.py`](../dataset/generate.py) (seed 42, mesma massa das outras cargas).
Os IDs são UUIDs determinísticos; o hot set é definido pela **ordem de criação** registrada em
`code/dataset/out/k6/dataset.json`:

| Conjunto | Composição | Tamanho |
| --- | --- | --- |
| Universo | 20 celebridades + 10.000 usuários comuns | 10.020 |
| Hot set | 20 celebridades + 480 primeiros usuários comuns (posições 1–500 na ordem de criação) | 500 |

**Distribuição Pareto 80/20** por requisição: 80% sorteadas uniformemente no hot set
(inclui as celebridades, que concentram seguidores no grafo) e 20% uniformemente entre todos os
10.020. O k6 expõe a contagem real por fatia na métrica `user_lookups{set=hot|cold}`, para
conferir a distribuição aplicada em cada execução.

## Carga (`code/k6/baseline_user_lookup.js`)

Uma única ação por iteração: `GET /usuarios/{id}` com o ID sorteado conforme o Pareto. Sem
escritas, sem think time (pressão de leitura sustentada; `THINK_MIN_MS`/`THINK_MAX_MS` estrangulam
se necessário) e sem aquecimento: o `restore` do snapshot entrega o mesmo estado frio às duas
arquiteturas, de forma simétrica.

| `MODE` | Perfil | Uso |
| --- | --- | --- |
| `smoke` (padrão) | rampa até 80 VUs (~10 s) + patamar 25 s + descida 5 s, ~40 s no total | validação local: contrato e rotas |
| `tcc` | rampa progressiva 100 → 400 → 600 VUs com patamar em cada degrau, ~5 min no total | coleta oficial e verificação de estabilidade de memória (patamar de 90 s no topo) |

## Validações e thresholds

Métrica customizada `contract_errors` (`Rate`): fração de respostas que violam o contrato —
status diferente de `200`, `id` diferente do requisitado, campo obrigatório ausente, de tipo
errado ou fora das restrições do schema. Thresholds declarados no script:

| Threshold | Limite |
| --- | --- |
| `http_req_failed` | `rate < 0.01` |
| `http_req_duration` | `p(95) < 500 ms` e `p(99) < 1000 ms` |
| `contract_errors` | `rate == 0` |

O smoke valida integridade de contrato; a latência sob saturação no `MODE=tcc` é **resultado** do
experimento, e a aprovação/reprovação dos thresholds fica registrada por execução em
[resultados.md](resultados.md). Falhas de limiar não invalidam os dados coletados.

## Execução

```bash
make viral-dataset           # uma vez: gera code/dataset/out
bash scripts/viral.sh snapshot sync && bash scripts/viral.sh snapshot async   # uma vez por dataset
make baseline-smoke-sync     # restore limpo + smoke no Laravel/MySQL
make baseline-smoke-async    # restore limpo + smoke no Hyperf/Neo4j
make baseline-tcc-sync       # restore limpo + coleta oficial (5 min)
make baseline-tcc-async
make resultados              # regenera code/docs/resultados.md
```

Cada target restaura o snapshot antes da carga: estado inicial idêntico entre execuções. A
observabilidade (Prometheus/Grafana/cAdvisor) sobe com `scripts/viral.sh obs up`; se o Prometheus
estiver em `:9090`, o k6 envia as séries via remote write automaticamente (dashboard
"TCC - Viralização", mesma grade do cenário viral). Os artefatos por execução ficam em
`code/k6/results/baseline-<arq>-<modo>-<instante>/` (`summary.json`, `output.log`,
`metricas-antes.json`, `metricas.json`).

## Limitações e decisões de método

- **Cache LRU do Hyperf (256 entradas por processo):** o `UserRepository` do backend assíncrono
  mantém cache em memória no caminho do `GET /usuarios/{id}` (existe também para validar autor no
  `POST /posts`). Com o hot set de 500 usuários, parte das leituras do async é servida da RAM do
  processo e não alcança o Neo4j; no Laravel cada leitura consulta o MySQL. O cache foi
  **mantido por decisão explícita**: o TCC compara as composições completas como construídas, e
  esse comportamento faz parte da arquitetura orientada a eventos sob teste. A comparação de
  latência precisa ser lida com essa assimetria em mente.
- **Carga só de leitura:** não há drenagem de filas nem contagens `aceitos × persistidos`;
  `metricas-antes.json` e `metricas.json` comprovam que a carga não altera o estado persistido.
- **Ruído do host:** containers de outros projetos na mesma máquina podem inflar a latência do
  smoke sem indicar defeito dos backends. Antes das coletas oficiais (`MODE=tcc`), manter o host
  estável ou registrar a carga paralela como limitação do experimento.
- **Orçamento de recursos:** o baseline usa as mesmas composições Docker do cenário viral
  (teto de 1,5 CPU e 3 GB por composição); a carga entra apenas pelo balanceador Nginx.

Registro histórico: o perfil de chegadas da Rinha (`code/k6/stress.js` + `code/k6/run.py`,
documentado em [teste-estresse.md](teste-estresse.md) e [code/k6/README.md](../k6/README.md))
antecede estes cenários e não é coletado pelo pipeline atual.
