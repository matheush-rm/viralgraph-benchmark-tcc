BASE_URL ?= http://127.0.0.1:9999
ARCHITECTURE ?= async
CONFIG ?= code/k6/config.json

.PHONY: stress pdf

# Grava dados; execute contra uma base experimental vazia.
stress:
	python3 code/k6/run.py \
		--base-url "$(BASE_URL)" \
		--architecture "$(ARCHITECTURE)" \
		--config "$(CONFIG)"

pdf:
	bash scripts/render-latex.sh

# Cenário de viralização (ver code/docs/viralizacao.md). VIRAL_ARCH=sync|async, MODE=smoke|tcc,
# SCENARIO=baseline|fanout|graph_read|mixed|organic|viral_peak, VUS_MAX=degrau de carga do MODE=tcc
# (não se aplica a organic/viral_peak, cujo pico de VUs é fixo pelo cenário).
VIRAL_ARCH ?= sync
MODE ?= smoke
SCENARIO ?= mixed
VUS_MAX ?= 600
VIRAL_SCENARIOS := baseline fanout graph_read mixed
# Degraus: moderado (20, rampa exploratória em code/docs/viralizacao.md) e estresse viral (600).
VIRAL_LEVELS ?= 20 600
# Limite da espera de drenagem pós-carga (filas/outbox vazias), em segundos.
DRAIN_TIMEOUT_S ?= 900
export DRAIN_TIMEOUT_S
.PHONY: viral-dataset viral-snapshot viral-restore viral-load viral-obs viral-tcc viral-tcc-all viral-tcc-levels
viral-dataset:
	bash scripts/viral.sh dataset
viral-snapshot:
	bash scripts/viral.sh snapshot $(VIRAL_ARCH)
viral-restore:
	bash scripts/viral.sh restore $(VIRAL_ARCH)
viral-load:
	MODE=$(MODE) SCENARIO=$(SCENARIO) VUS_MAX=$(VUS_MAX) bash scripts/viral.sh load $(VIRAL_ARCH)
viral-obs:
	bash scripts/viral.sh obs up
# Restaura o snapshot limpo e roda um cenário em MODE=tcc (3 min): make viral-tcc SCENARIO=fanout
viral-tcc:
	SCENARIO=$(SCENARIO) VUS_MAX=$(VUS_MAX) bash scripts/viral.sh tcc $(VIRAL_ARCH)
# Os 4 cenários em sequência, cada um sobre snapshot restaurado.
viral-tcc-all:
	set -e; for s in $(VIRAL_SCENARIOS); do SCENARIO=$$s VUS_MAX=$(VUS_MAX) bash scripts/viral.sh tcc $(VIRAL_ARCH); done
# Um cenário em cada degrau de VIRAL_LEVELS, restore limpo antes de cada um.
viral-tcc-levels:
	set -e; for v in $(VIRAL_LEVELS); do SCENARIO=$(SCENARIO) VUS_MAX=$$v bash scripts/viral.sh tcc $(VIRAL_ARCH); done

# Baseline (controle): busca de perfil por ID sob alta concorrência (ver code/docs/baseline-user-lookup.md).
# Cada target restaura o snapshot limpo antes da carga; sem warmup (a carga é só de leitura).
.PHONY: baseline-smoke-sync baseline-smoke-async baseline-tcc-sync baseline-tcc-async resultados
baseline-smoke-sync:
	bash scripts/viral.sh restore sync && MODE=smoke bash scripts/viral.sh baseline sync
baseline-smoke-async:
	bash scripts/viral.sh restore async && MODE=smoke bash scripts/viral.sh baseline async
baseline-tcc-sync:
	bash scripts/viral.sh restore sync && MODE=tcc bash scripts/viral.sh baseline sync
baseline-tcc-async:
	bash scripts/viral.sh restore async && MODE=tcc bash scripts/viral.sh baseline async

# Cenários finais de viralização (ver code/docs/cenarios.md e code/docs/viralizacao.md):
# organic (escrita comum sem celebridade, rampa suave) e viral_peak (cascata em fases). Cada target
# restaura o snapshot limpo antes da carga; o pico de VUs é fixo pelo cenário (não usa VUS_MAX).
.PHONY: viral-organic-sync viral-organic-async viral-peak-sync viral-peak-async
viral-organic-sync:
	bash scripts/viral.sh restore sync && MODE=$(MODE) SCENARIO=organic bash scripts/viral.sh load sync
viral-organic-async:
	bash scripts/viral.sh restore async && MODE=$(MODE) SCENARIO=organic bash scripts/viral.sh load async
viral-peak-sync:
	bash scripts/viral.sh restore sync && MODE=$(MODE) SCENARIO=viral_peak bash scripts/viral.sh load sync
viral-peak-async:
	bash scripts/viral.sh restore async && MODE=$(MODE) SCENARIO=viral_peak bash scripts/viral.sh load async

# Relatório de resultados gerado a partir de code/k6/results (não editar à mão).
resultados:
	python3 scripts/resultados.py

# Bateria oficial de experimentos (ver code/docs/cenarios.md e code/docs/viralizacao.md).
# A suite estatística roda com o OpenTelemetry DESLIGADO; o tracing é coletado à parte.
.PHONY: tcc-suite smoke-suite trace-evidence
# Bateria completa: 3 repetições dos três cenários finais (baseline, organic, viral_peak) × sync/async.
tcc-suite:
	MODE=tcc REPS=3 bash scripts/run_tcc_suite.sh
# Fumaça da bateria: 2 repetições em MODE=smoke, para validar o fluxo sem a coleta oficial.
smoke-suite:
	MODE=smoke REPS=2 bash scripts/run_tcc_suite.sh
# Evidência de rastreamento distribuído: rodada ÚNICA com OpenTelemetry ligado para gerar a figura
# no Jaeger (UI http://127.0.0.1:16686). Suba o Jaeger antes (bash scripts/viral.sh obs up).
# Fora da bateria estatística: o custo da instrumentação não entra nas métricas de desempenho.
TRACE_ARCH ?= async
TRACE_SCENARIO ?= viral_peak
trace-evidence:
	OTEL_ENABLED=1 OTEL_SDK_DISABLED=false OTEL_TRACES_SAMPLER_ARG=$${OTEL_TRACES_SAMPLER_ARG:-0.02} \
		REPS=1 MODE=$(MODE) ARCHS="$(TRACE_ARCH)" SCENARIOS="$(TRACE_SCENARIO)" \
		bash scripts/run_tcc_suite.sh
