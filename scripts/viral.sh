#!/usr/bin/env bash
# Cenário de viralização: dataset Zipf pré-semeado, snapshot de volumes e carga k6.
#
#   scripts/viral.sh dataset                 gera code/dataset/out (SQL, Cypher, IDs do k6)
#   scripts/viral.sh snapshot sync|async     aplica o seed num volume vazio e salva o volume em tar
#   scripts/viral.sh restore  sync|async     recria o volume a partir do tar e sobe o ambiente
#   scripts/viral.sh down     sync|async     derruba o ambiente (remove volumes do projeto)
#   scripts/viral.sh obs up|down             Prometheus + Grafana + cAdvisor
#   scripts/viral.sh warmup   sync|async     aquecimento só de leitura (GET), fora da medição
#   MODE=smoke|tcc SCENARIO=baseline|fanout|graph_read|mixed scripts/viral.sh load sync|async
#                                            (roda warmup antes; WARMUP=0 desliga)
#   SCENARIO=... scripts/viral.sh tcc sync|async   restore + load MODE=tcc (snapshot limpo)
#   MODE=smoke|tcc scripts/viral.sh baseline sync|async   GET /usuarios/{id} puro (controle;
#                                            ver code/docs/baseline-user-lookup.md)
#   scripts/viral.sh counts   sync|async     contagens direto no banco (posts, shares, feed, outbox)
#
# VUS_MAX define o degrau de carga do MODE=tcc (padrão 600). Ao fim da carga, o script conta direto
# no banco, espera a drenagem (filas/outbox vazias e contagens estáveis, até DRAIN_TIMEOUT_S) e grava
# contagens.json: aceitos (respostas do k6) x persistidos ao fim da carga x persistidos após drenagem.
#
# Opera somente nos projetos Compose tcc-viral-sync e tcc-viral-async.
set -euo pipefail
export LC_NUMERIC=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATASET="${DATASET:-$ROOT/code/dataset/out}"
SNAPSHOTS="${SNAPSHOTS:-$DATASET/snapshots}"
SYNC_PORT="${SYNC_PORT:-19998}"
ASYNC_PORT="${ASYNC_PORT:-19999}"
ALPINE="alpine:3.20"

log() { printf '[viral] %s\n' "$*" >&2; }
die() { log "erro: $*"; exit 1; }

compose() {
  local arch="$1"; shift
  case "$arch" in
    sync)
      CORPUS_DIR="$DATASET" BENCHMARK_PORT="$SYNC_PORT" docker compose -p tcc-viral-sync \
        -f "$ROOT/backends/laravel-sync/compose.benchmark.yaml" "$@" ;;
    async)
      CORPUS_DIR="$DATASET" BENCHMARK_PORT="$ASYNC_PORT" docker compose -p tcc-viral-async \
        -f "$ROOT/backends/hyperf-async/compose.yaml" \
        -f "$ROOT/backends/hyperf-async/compose.benchmark.yaml" "$@" ;;
    *) die "arquitetura inválida: $arch (sync|async)" ;;
  esac
}

volume_of() { [ "$1" = sync ] && echo tcc-viral-sync_mysql_benchmark || echo tcc-viral-async_neo4j; }
store_of()  { [ "$1" = sync ] && echo mysql || echo neo4j; }

require_dataset() {
  [ -f "$DATASET/manifest.json" ] || die "dataset ausente em $DATASET; rode: scripts/viral.sh dataset"
}

cmd_dataset() {
  [ -e "$DATASET/manifest.json" ] && die "$DATASET já existe; remova-o para gerar de novo."
  python3 "$ROOT/code/dataset/generate.py" --output "$DATASET" "$@"
}

cmd_snapshot() {
  local arch="$1" store volume started
  require_dataset
  store="$(store_of "$arch")"; volume="$(volume_of "$arch")"
  log "$arch: recriando volume vazio $volume"
  compose "$arch" down -v --remove-orphans >/dev/null 2>&1 || true
  started=$(date +%s)
  if [ "$arch" = sync ]; then
    # Construção do snapshot fora do orçamento medido.
    MYSQL_CPUS="${SNAPSHOT_CPUS:-2}" compose sync up -d --wait mysql
    log "sync: migrations"
    compose sync run --rm --no-deps -T api1 php artisan migrate --force --no-interaction
    log "sync: aplicando mysql/seed.sql.gz"
    gunzip -c "$DATASET/mysql/seed.sql.gz" | compose sync exec -T mysql \
      mysql -ubenchmark -pbenchmark-local laravel_sync_benchmark
    compose sync exec -T mysql mysql -N -ubenchmark -pbenchmark-local laravel_sync_benchmark -e \
      "SELECT 'users',COUNT(*) FROM users UNION ALL SELECT 'follows',COUNT(*) FROM follows UNION ALL
       SELECT 'posts',COUNT(*) FROM posts UNION ALL SELECT 'shares',COUNT(*) FROM shares UNION ALL
       SELECT 'feed_items',COUNT(*) FROM feed_items"
  else
    local image
    image="$(compose async config --images neo4j | head -1)"
    compose async create neo4j >/dev/null 2>&1   # cria o volume do projeto
    log "async: neo4j-admin database import full (offline)"
    docker run --rm -v "$volume:/data" -v "$DATASET/neo4j:/seed:ro" "$image" \
      neo4j-admin database import full neo4j --overwrite-destination=true \
        --nodes=User=/seed/users.csv.gz --nodes=Post=/seed/posts.csv.gz \
        --relationships=AUTHORED=/seed/authored.csv.gz --relationships=FOLLOWS=/seed/follows.csv.gz \
        --relationships=SHARED=/seed/shared.csv.gz --relationships=RESHARED_FROM=/seed/reshared_from.csv.gz \
        --relationships=FEED=/seed/feed.csv.gz
    NEO4J_CPUS="${SNAPSHOT_CPUS:-2}" NEO4J_MEMORY="${SNAPSHOT_NEO4J_MEMORY:-3g}" compose async up -d --wait neo4j
    # Cliente cypher-shell (JVM) em container próprio: não disputa a memória do servidor.
    local shell=(docker run --rm -i --network tcc-viral-async_default "$image"
      cypher-shell -a neo4j://neo4j:7687 -u neo4j -p "${NEO4J_PASSWORD:-benchmark-local}" --format plain)
    log "async: schema.cypher (constraints e índices)"
    "${shell[@]}" < "$DATASET/neo4j/schema.cypher"
    "${shell[@]}" \
      "CALL { MATCH (u:User) RETURN count(u) AS users } CALL { MATCH ()-[f:FOLLOWS]->() RETURN count(f) AS follows }
       CALL { MATCH (p:Post) RETURN count(p) AS posts } CALL { MATCH ()-[s:SHARED]->() RETURN count(s) AS shares }
       CALL { MATCH ()-[e:FEED]->() RETURN count(e) AS feed_items } RETURN users, follows, posts, shares, feed_items"
  fi
  log "$arch: seed aplicado em $(( $(date +%s) - started ))s; salvando volume"
  compose "$arch" stop "$store"
  mkdir -p "$SNAPSHOTS"
  docker run --rm -v "$volume:/data:ro" -v "$SNAPSHOTS:/snap" "$ALPINE" \
    tar -C /data -cf "/snap/$arch-$store.tar" .
  compose "$arch" down >/dev/null
  log "$arch: snapshot em $SNAPSHOTS/$arch-$store.tar ($(du -h "$SNAPSHOTS/$arch-$store.tar" | cut -f1))"
}

cmd_restore() {
  local arch="$1" store volume tarball t0 t1
  store="$(store_of "$arch")"; volume="$(volume_of "$arch")"
  tarball="$SNAPSHOTS/$arch-$store.tar"
  [ -f "$tarball" ] || die "snapshot ausente: $tarball; rode: scripts/viral.sh snapshot $arch"
  t0=$(date +%s.%N)
  compose "$arch" down -v --remove-orphans >/dev/null 2>&1 || true
  # Rótulos do Compose: o volume restaurado é reconhecido como do projeto (sem aviso de "external").
  docker volume create --label "com.docker.compose.project=tcc-viral-$arch" \
    --label "com.docker.compose.volume=${volume#tcc-viral-${arch}_}" "$volume" >/dev/null
  docker run --rm -v "$volume:/data" -v "$SNAPSHOTS:/snap:ro" "$ALPINE" tar -C /data -xpf "/snap/$arch-$store.tar"
  t1=$(date +%s.%N)
  log "$arch: volume restaurado em $(printf '%.1f' "$(echo "$t1 - $t0" | bc)")s; subindo serviços"
  compose "$arch" up -d --wait --build
  log "$arch: pronto em $(printf '%.1f' "$(echo "$(date +%s.%N) - $t0" | bc)")s (restauração + healthchecks)"
}

cmd_down() { compose "$1" down -v --remove-orphans; }

cmd_obs() {
  docker compose -p tcc-observability -f "$ROOT/observability/compose.yaml" "${1:-up}" \
    $([ "${1:-up}" = up ] && echo "-d --wait")
}

port_of() { [ "$1" = sync ] && echo "$SYNC_PORT" || echo "$ASYNC_PORT"; }

# Mesmo procedimento nas duas arquiteturas: uma passada de GETs (árvores virais + feeds).
# Sem remote write: não entra nas séries do Prometheus/Grafana da carga medida.
cmd_warmup() {
  local arch="$1" out
  require_dataset
  out="$ROOT/code/k6/results/viral-$arch-warmup-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$out"
  log "k6 $arch MODE=warmup -> $out"
  MODE=warmup ARCH="$arch" BASE_URL="http://127.0.0.1:$(port_of "$arch")" \
    DATASET="$DATASET/k6/dataset.json" \
    k6 run --tag "arch=$arch" --tag "mode=warmup" \
      --summary-export "$out/summary.json" "$ROOT/code/k6/viral.js" 2>&1 | tee "$out/output.log"
}

# Contagens lidas direto no banco, sem passar pela API (que pode seguir saturada ao fim da carga).
# tarefas_pendentes: outbox de distribuição do Hyperf ainda não concluída (sempre 0 no síncrono).
# shares_deduplicados: shares aceitos (202) que o MERGE do worker absorveu por já existirem (sempre 0
# no síncrono, que rejeita com 422 dentro da transação).
db_counts() {
  local arch="$1"
  if [ "$arch" = sync ]; then
    compose sync exec -T mysql mysql -N -B -ubenchmark -pbenchmark-local laravel_sync_benchmark -e \
      "SELECT (SELECT COUNT(*) FROM posts), (SELECT COUNT(*) FROM shares), (SELECT COUNT(*) FROM feed_items)" \
      2>/dev/null | awk '{printf "{\"posts\":%d,\"shares\":%d,\"feed_items\":%d,\"tarefas_pendentes\":0,\"shares_deduplicados\":0}\n", $1, $2, $3}'
  else
    local body='{"statements":[{"statement":"CALL { MATCH (p:Post) RETURN count(p) AS posts } CALL { MATCH ()-[s:SHARED]->() RETURN count(s) AS shares } CALL { MATCH ()-[e:FEED]->() RETURN count(e) AS feed } CALL { MATCH (t:Task) WHERE t.done = false RETURN count(t) AS pendentes } CALL { MATCH (d:ShareDuplicate) RETURN count(d) AS dedup } RETURN posts, shares, feed, pendentes, dedup"}]}'
    compose async exec -T neo4j wget -q -O - --auth-no-challenge --user=neo4j \
      --password="${NEO4J_PASSWORD:-benchmark-local}" --header='Content-Type: application/json' \
      --post-data="$body" http://127.0.0.1:7474/db/neo4j/tx/commit \
      | jq -ce 'if (.errors | length) > 0 then error(.errors[0].message) else .results[0].data[0].row
          | {posts: .[0], shares: .[1], feed_items: .[2], tarefas_pendentes: .[3], shares_deduplicados: .[4]} end'
  fi
}

# Mensagens nas filas do RabbitMQ (prontas + sem ack); -1 se o endpoint não responder.
queue_depth() {
  local body
  body="$(curl -fsS --max-time 5 "http://127.0.0.1:${RABBITMQ_METRICS_PORT:-15692}/metrics/per-object" 2>/dev/null)" \
    || { echo -1; return; }
  awk '/^rabbitmq_queue_messages\{/ { s += $NF } END { print s + 0 }' <<<"$body"
}

# Espera a conclusão do trabalho aceito: filas e outbox vazias (async) e contagens iguais em duas
# leituras seguidas (as duas arquiteturas; no síncrono, requisições abandonadas pelo k6 por timeout
# ainda podem estar gravando). Imprime JSON com as contagens finais e o tempo de drenagem, medido do
# fim da carga até a primeira leitura do par estável (resolução = DRAIN_POLL_S).
wait_drain() {
  local arch="$1" timeout="${DRAIN_TIMEOUT_S:-900}" interval="${DRAIN_POLL_S:-5}"
  local t0 now cur prev="" prev_at=0 depth pending complete=false
  t0=$(date +%s)
  while :; do
    now=$(( $(date +%s) - t0 ))
    cur="$(db_counts "$arch")" || cur=""
    depth=0; [ "$arch" = async ] && depth="$(queue_depth)"
    pending="$(jq -r '.tarefas_pendentes' <<<"$cur" 2>/dev/null)" || pending=-1
    log "drenagem ${now}s: filas=$depth $cur"
    if [ -n "$cur" ] && [ "$cur" = "$prev" ] && [ "$depth" = 0 ] && [ "$pending" = 0 ]; then
      complete=true; break
    fi
    [ "$now" -ge "$timeout" ] && break
    [ "$cur" = "$prev" ] || prev_at=$now
    prev="$cur"
    sleep "$interval"
  done
  jq -cn --argjson final "${cur:-null}" --argjson complete "$complete" --argjson s "$prev_at" \
    --argjson timeout "$timeout" --argjson interval "$interval" --argjson depth "$depth" \
    '{final: $final, drenagem: {completa: $complete, segundos: (if $complete then $s else null end),
      timeout_s: $timeout, intervalo_s: $interval, filas_restantes: $depth}}'
}

# contagens.json: aceitos (2xx vistos pelo k6) x persistidos (delta no banco) ao fim da carga e após
# a drenagem. Shares aceitos descontam os 422 (share_duplicates).
write_counts() {
  local out="$1" arch="$2" scenario="$3" start="$4" end="$5" drain="$6"
  jq -n --arg arch "$arch" --arg scenario "$scenario" --arg mode "${MODE:-smoke}" \
    --argjson vus "${VUS_MAX:-600}" --argjson inicio "$start" --argjson fim "$end" --argjson drain "$drain" \
    --slurpfile summary "$out/summary.json" '
    def passes(re): [$summary[0].root_group.checks | to_entries[] | select(.key | test(re)) | .value.passes] | add // 0;
    def delta(a; b): {posts: (b.posts - a.posts), shares: (b.shares - a.shares), feed_items: (b.feed_items - a.feed_items),
      shares_deduplicados: ((b.shares_deduplicados // 0) - (a.shares_deduplicados // 0))};
    {arquitetura: $arch, cenario: $scenario, modo: $mode, vus_max: (if $mode == "tcc" then $vus else null end),
     aceitos: {posts: passes("^(posts_create|celebrity_post) "),
               shares: (passes("^(share|celebrity_share) ") - ($summary[0].metrics.share_duplicates.count // 0))},
     inicio: $inicio, fim_carga: $fim, final: $drain.final,
     persistidos_fim_carga: (if $fim then delta($inicio; $fim) else null end),
     persistidos_final: (if $drain.final then delta($inicio; $drain.final) else null end),
     drenagem: $drain.drenagem}' > "$out/contagens.json"
}

cmd_counts() { db_counts "$1"; }

cmd_load() {
  local arch="$1" scenario="${SCENARIO:-mixed}" port metrics_url out level="" start end drain
  require_dataset
  [ "${WARMUP:-1}" = 0 ] || cmd_warmup "$arch"
  port="$(port_of "$arch")"
  metrics_url=""
  [ "$arch" = async ] && metrics_url="http://127.0.0.1:${RABBITMQ_METRICS_PORT:-15692}/metrics/per-object"
  [ "${MODE:-smoke}" = tcc ] && level="-vus${VUS_MAX:-600}"
  out="$ROOT/code/k6/results/viral-$arch-${MODE:-smoke}-$scenario$level-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$out"
  local outputs=()
  if curl -fsS -o /dev/null "http://127.0.0.1:9090/-/ready" 2>/dev/null; then
    outputs=(-o experimental-prometheus-rw)
    export K6_PROMETHEUS_RW_SERVER_URL="http://127.0.0.1:9090/api/v1/write"
    export K6_PROMETHEUS_RW_TREND_STATS="p(50),p(95),p(99),avg,max"
  fi
  start="$(db_counts "$arch")" || die "$arch: contagem inicial no banco falhou"
  log "k6 $arch MODE=${MODE:-smoke} SCENARIO=$scenario VUS_MAX=${VUS_MAX:-600} -> $out"
  log "contagens iniciais: $start"
  # Thresholds reprovados (ex.: falhas >= 20% no smoke) não podem pular as contagens: guarda o código do k6.
  local rc=0
  MODE="${MODE:-smoke}" SCENARIO="$scenario" ARCH="$arch" BASE_URL="http://127.0.0.1:$port" \
    DATASET="$DATASET/k6/dataset.json" RABBITMQ_METRICS_URL="$metrics_url" VUS_MAX="${VUS_MAX:-600}" \
    k6 run "${outputs[@]}" --tag "arch=$arch" --tag "mode=${MODE:-smoke}" --tag "experiment=$scenario" \
      --tag "vus_max=${VUS_MAX:-600}" \
      --summary-export "$out/summary.json" "$ROOT/code/k6/viral.js" 2>&1 | tee "$out/output.log" || rc=$?
  end="$(db_counts "$arch")" || end='null'
  log "contagens ao fim da carga: $end"
  drain="$(wait_drain "$arch")"
  write_counts "$out" "$arch" "$scenario" "$start" "$end" "$drain"
  log "contagens: $(jq -c '{aceitos, persistidos_fim_carga, persistidos_final, drenagem}' "$out/contagens.json")"
  return "$rc"
}

# Baseline (controle): GET /usuarios/{id} puro, Pareto 80/20 sobre o dataset (ver
# code/docs/baseline-user-lookup.md). Sem escrita: não há drenagem nem contagens de aceitos;
# /metricas antes e depois prova que a carga de leitura não alterou o estado persistido.
cmd_baseline() {
  local arch="$1" port out rc=0
  require_dataset
  port="$(port_of "$arch")"
  out="$ROOT/code/k6/results/baseline-$arch-${MODE:-smoke}-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$out"
  local outputs=()
  if curl -fsS -o /dev/null "http://127.0.0.1:9090/-/ready" 2>/dev/null; then
    outputs=(-o experimental-prometheus-rw)
    export K6_PROMETHEUS_RW_SERVER_URL="http://127.0.0.1:9090/api/v1/write"
    export K6_PROMETHEUS_RW_TREND_STATS="p(50),p(95),p(99),avg,max"
  fi
  curl -fsS "http://127.0.0.1:$port/metricas" > "$out/metricas-antes.json" || true
  log "k6 $arch MODE=${MODE:-smoke} baseline_user_lookup -> $out"
  MODE="${MODE:-smoke}" BASE_URL="http://127.0.0.1:$port" \
    DATASET="$DATASET/k6/dataset.json" \
    k6 run "${outputs[@]}" --tag "arch=$arch" --tag "mode=${MODE:-smoke}" --tag "experiment=user_lookup" \
      --summary-export "$out/summary.json" "$ROOT/code/k6/baseline_user_lookup.js" 2>&1 | tee "$out/output.log" || rc=$?
  curl -fsS "http://127.0.0.1:$port/metricas" > "$out/metricas.json" || true
  log "métricas finais: $(cat "$out/metricas.json" 2>/dev/null)"
  return "$rc"
}

case "${1:-}" in
  dataset) shift; cmd_dataset "$@" ;;
  snapshot) cmd_snapshot "${2:?sync|async}" ;;
  warmup) cmd_warmup "${2:?sync|async}" ;;
  restore) cmd_restore "${2:?sync|async}" ;;
  down) cmd_down "${2:?sync|async}" ;;
  obs) cmd_obs "${2:-up}" ;;
  load) cmd_load "${2:?sync|async}" ;;
  baseline) cmd_baseline "${2:?sync|async}" ;;
  counts) cmd_counts "${2:?sync|async}" ;;
  tcc) cmd_restore "${2:?sync|async}"; MODE=tcc cmd_load "$2" ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
