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
# SCENARIO=baseline|fanout|graph_read|mixed, VUS_MAX=degrau de carga do MODE=tcc.
VIRAL_ARCH ?= sync
MODE ?= smoke
SCENARIO ?= mixed
VUS_MAX ?= 600
VIRAL_SCENARIOS := baseline fanout graph_read mixed
# Degraus: moderado (150, assumed: confirmar por rampa exploratória) e estresse viral (600).
VIRAL_LEVELS ?= 150 600
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
