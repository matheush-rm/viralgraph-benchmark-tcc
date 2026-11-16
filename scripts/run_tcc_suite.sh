#!/usr/bin/env bash
# Executor da bateria oficial de experimentos: repetições estatísticas dos três cenários finais
# (baseline de busca de perfil, viralização organic e viral_peak) nas duas composições
# arquiteturais (sync e async). Reaproveita scripts/viral.sh (restore/baseline/load): cada
# repetição restaura o snapshot limpo (up --wait, portanto healthchecks) antes da carga.
#
#   REPS=3 MODE=tcc bash scripts/run_tcc_suite.sh            # bateria completa (padrão)
#   REPS=2 MODE=smoke bash scripts/run_tcc_suite.sh          # fumaça mais curta
#   DRY_RUN=1 bash scripts/run_tcc_suite.sh                  # só imprime o plano, não executa
#   ARCHS="async" SCENARIOS="viral_peak" bash scripts/run_tcc_suite.sh   # subconjunto
#
# A suite estatística roda com o OpenTelemetry DESLIGADO (OTEL_SDK_DISABLED=true e amostragem 0):
# o tracing distribuído é coletado à parte, numa rodada única com OTEL_ENABLED=1 (ver
# `make trace-evidence`). Assim as métricas de desempenho não pagam o custo da instrumentação.
#
# Cada run usa os próprios artefatos de scripts/viral.sh em code/k6/results/; o parser
# scripts/resultados.py agrega as repetições na seção "Consolidação Estatística (MODE=tcc)".
set -euo pipefail
export LC_NUMERIC=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIRAL="$ROOT/scripts/viral.sh"

REPS="${REPS:-3}"
MODE="${MODE:-tcc}"
ARCHS="${ARCHS:-sync async}"
SCENARIOS="${SCENARIOS:-baseline organic viral_peak}"
DRY_RUN="${DRY_RUN:-0}"

# A bateria estatística não instrumenta: desliga o SDK OTel nos dois backends e zera a amostragem.
# `make trace-evidence` sobrescreve estas variáveis com OTEL_ENABLED=1 numa rodada separada.
export OTEL_SDK_DISABLED="${OTEL_SDK_DISABLED:-true}"
export OTEL_ENABLED="${OTEL_ENABLED:-0}"
export OTEL_TRACES_SAMPLER="${OTEL_TRACES_SAMPLER:-traceidratio}"
export OTEL_TRACES_SAMPLER_ARG="${OTEL_TRACES_SAMPLER_ARG:-0}"

LOG_DIR="$ROOT/code/k6/results/suite-logs"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SUITE_LOG="$LOG_DIR/suite-$MODE-$STAMP.log"

log() { printf '[suite] %s\n' "$*" >&2; }

run_step() {
  # run_step <descrição> <comando...>; captura o rc por amostra sem abortar a bateria toda.
  local label="$1"; shift
  log "== $label"
  if [ "$DRY_RUN" = 1 ]; then
    printf '[suite] DRY_RUN: %s\n' "$*" >&2
    return 0
  fi
  local rc=0
  "$@" >>"$SUITE_LOG" 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then
    log "ok: $label"
  else
    log "FALHA (rc=$rc): $label — veja $SUITE_LOG"
  fi
  printf '%s\trc=%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" "$label" >>"$LOG_DIR/suite-$MODE-$STAMP.index"
  return 0
}

mkdir -p "$LOG_DIR"
log "bateria MODE=$MODE REPS=$REPS ARCHS=[$ARCHS] SCENARIOS=[$SCENARIOS] OTEL_ENABLED=$OTEL_ENABLED"
log "log consolidado: $SUITE_LOG"
[ "$DRY_RUN" = 1 ] && log "DRY_RUN=1: nenhum comando será executado"

fail_count=0
total=0
for rep in $(seq 1 "$REPS"); do
  for arch in $ARCHS; do
    for scenario in $SCENARIOS; do
      total=$((total + 1))
      tag="rep=$rep arch=$arch scenario=$scenario mode=$MODE"
      # Restaura o snapshot limpo antes de CADA repetição (cmd_restore faz up --wait = healthchecks).
      run_step "restore [$tag]" bash "$VIRAL" restore "$arch"
      if [ "$scenario" = baseline ]; then
        # Baseline de controle: GET /usuarios/{id}; usa o comando baseline do viral.sh.
        run_step "baseline [$tag]" env MODE="$MODE" bash "$VIRAL" baseline "$arch"
      else
        # organic / viral_peak: carga de viralização via comando load com SCENARIO.
        run_step "load $scenario [$tag]" env MODE="$MODE" SCENARIO="$scenario" bash "$VIRAL" load "$arch"
      fi
    done
  done
done

if [ "$DRY_RUN" != 1 ] && [ -f "$LOG_DIR/suite-$MODE-$STAMP.index" ]; then
  fail_count="$(awk -F'\t' '$2 != "rc=0"' "$LOG_DIR/suite-$MODE-$STAMP.index" | wc -l | tr -d ' ')"
fi

log "bateria concluída: $total passos planejados, $fail_count com falha"
log "gere o relatório com: python3 scripts/resultados.py"
# Falhas de amostra não derrubam a bateria; o código de saída só sinaliza se houve alguma.
[ "$fail_count" -eq 0 ]
