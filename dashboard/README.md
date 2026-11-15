# Painel de experimentos de viralização

SPA local para disparar e comparar as execuções descritas em [`code/docs/viralizacao.md`](../code/docs/viralizacao.md). Node 18+, sem dependências.

```bash
node dashboard/server.mjs        # http://127.0.0.1:8765  (PORT=… para trocar)
```

- **Arquiteturas**: dataset Zipf (lido de `code/dataset/out/manifest.json`), fluxo de escrita e orçamento de 1,5 CPU / 3 GB de cada composição, mistura de tráfego e degraus.
- **Execução**: `POST /api/run` `{arch, mode, scenario, vus, restore}` roda `make viral-tcc …` (modo tcc) ou `make viral-restore` + `make viral-load MODE=smoke …` (smoke). Logs via SSE em `/api/stream`; uma execução por vez (409 se ocupado); `POST /api/abort` manda SIGINT ao grupo de processos, SIGTERM após 10 s e SIGKILL após 20 s se algo restar. Fases inferidas das mensagens `[viral]` do script. Log completo de cada disparo em `dashboard/runs/` (ignorado pelo Git).
- **Comparação**: lê `code/k6/results/viral-*` (sem warmup): `summary.json` e `contagens.json`. Cartões, latência e falha por rota, auditoria aceitos × persistidos e exportação Markdown/CSV (`;`, vírgula decimal).

O servidor só escuta em 127.0.0.1 porque executa comandos no host. Não altera `backends/`, `scripts/` nem `code/k6/`.
