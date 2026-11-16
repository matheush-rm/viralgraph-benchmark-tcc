# Painel de experimentos de viralização

SPA local para disparar e comparar as execuções descritas em [`code/docs/viralizacao.md`](../code/docs/viralizacao.md). Node 18+, sem dependências.

```bash
node dashboard/server.mjs        # http://127.0.0.1:8765  (PORT=… para trocar)
```

## Tipos de teste (`kind`)

O painel dispara e compara dois tipos de experimento, informados pelo campo `kind` do payload:

- **`viral`** (padrão): publicações e compartilhamentos em cascata, que geram escrita. Mede vazão, latência, filas e consistência eventual (aceitos × persistidos).
- **`user_lookup`** (baseline de leitura de perfil): controle que só lê. Não grava nada e verifica um contrato de latência e de formato. `contract_errors` só é medido aqui; warmup e drenagem não se aplicam.

## Seções

- **Arquiteturas**: dataset Zipf (lido de `code/dataset/out/manifest.json`), fluxo de escrita e orçamento de 1,5 CPU / 3 GB de cada composição, mistura de tráfego e degraus.
- **Execução**: `POST /api/run` com `{kind, arch, mode, scenario, vus, restore}` (`kind` opcional, padrão `viral`). O servidor monta os comandos conforme o tipo:

  | Tipo | Modo | Comando equivalente |
  | --- | --- | --- |
  | `viral`, cenário comum (`mixed`/`baseline`/`fanout`/`graph_read`) | `tcc` | `make viral-tcc VIRAL_ARCH=<arch> SCENARIO=<cen> VUS_MAX=<vus>` |
  | `viral`, cenário comum | `smoke` | `make viral-restore` (se restore) + `make viral-load VIRAL_ARCH=<arch> MODE=smoke SCENARIO=<cen>` |
  | `viral`, `organic`/`viral_peak` | ambos | `make viral-organic-<arch>` / `make viral-peak-<arch> MODE=<modo>` (restore sempre encadeado, pico fixo pelo cenário: 50 smoke / 300 tcc; `VUS_MAX` e o checkbox de restore não se aplicam) |
  | `user_lookup` | `tcc` | `make baseline-tcc-<arch>` (degraus 100→400→600) |
  | `user_lookup` | `smoke`, com restore | `make baseline-smoke-<arch>` (80 VUs) |
  | `user_lookup` | `smoke`, sem restore | `MODE=smoke bash scripts/viral.sh baseline <arch>` |

  Logs via SSE em `/api/stream`; uma execução por vez (409 se ocupado); `POST /api/abort` manda SIGINT ao grupo de processos, SIGTERM após 10 s e SIGKILL após 20 s se algo restar. Fases inferidas das mensagens `[viral]` do script (baseline: `restore → load → done`; viral: `restore → warmup → load → drain → done`). Log completo de cada disparo em `dashboard/runs/` (ignorado pelo Git).
- **Comparação**: lê `code/k6/results/` (ignora `*-warmup-*` e `suite-logs`). Artefatos por tipo:
  - `viral-*` (inclui os cenários `organic` e `viral_peak`): `summary.json` + `contagens.json`.
  - `baseline-*` (`user_lookup`): `summary.json` + `metricas-antes.json` + `metricas.json` (estado do banco antes e depois da carga; não há `contagens.json`).

  Cartões, latência e falha por rota, exportação Markdown/CSV (`;`, vírgula decimal). A auditoria se adapta à seleção: só viral mostra aceitos × persistidos; só baseline mostra o estado do banco antes × depois (prova de leitura pura); seleção mista usa a auditoria viral, tolerante a traços.

O servidor só escuta em 127.0.0.1 porque executa comandos no host. Não altera `backends/`, `scripts/` nem `code/k6/`.
