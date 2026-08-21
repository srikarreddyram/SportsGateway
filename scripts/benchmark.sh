#!/usr/bin/env bash
#
# Milestone 9 — caching before/after.
#
# Runs the same live-match burst twice, once with caching off and once with it on, and
# reports the difference in upstream calls and latency. The upstream call counts come
# from the mock provider's own request counter, so the headline number is measured at
# the provider rather than inferred from the gateway's own metrics.
#
#   ./scripts/benchmark.sh          # full run, roughly 15 minutes
#   ./scripts/benchmark.sh --quick  # 30s per case, for checking the plumbing
set -euo pipefail

cd "$(dirname "$0")/.."

SCRIPT=burst.js
if [[ "${1:-}" == "--quick" ]]; then
  SCRIPT=smoke.js
fi

# Rate limiting is switched off for both runs so the comparison isolates caching.
# Left on, the outbound limiter would cap the no-cache baseline at the provider quota,
# and the "reduction in upstream calls" would be measuring the limiter, not the cache.
# The limiters have their own tests and their own load scenario.
export RL_INBOUND_ENABLED=false
export RL_OUTBOUND_ENABLED=false

# Matches docker-compose.yml's own default so the token this script sends always agrees
# with whatever the container actually enforces, whether or not the caller overrode it.
export ADMIN_TOKEN="${ADMIN_TOKEN:-sportsgateway-demo-admin-token-change-me}"

MOCK_PORT="${MOCK_PORT:-8081}"
GATEWAY_PORT="${GATEWAY_PORT:-8080}"
MOCK_URL="http://localhost:${MOCK_PORT}"
GATEWAY_URL="http://localhost:${GATEWAY_PORT}"
RESULTS_DIR="results"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: $1 is required but not installed" >&2; exit 1; }
}

require docker
require node
docker compose version >/dev/null 2>&1 || { echo "error: docker compose v2 is required" >&2; exit 1; }

wait_for_gateway() {
  for _ in $(seq 1 60); do
    if curl -fsS "${GATEWAY_URL}/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "error: gateway did not become healthy at ${GATEWAY_URL}" >&2
  exit 1
}

# Reads one numeric field out of the mock provider's stats endpoint.
upstream_total() {
  curl -fsS "${MOCK_URL}/__stats" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).total))'
}

run_case() {
  local label="$1" cache_enabled="$2"

  log "Case '${label}' (CACHE_ENABLED=${cache_enabled})"

  # Exported, not just prefixed onto the `up` command: `docker compose run` below starts
  # k6's dependencies, and it recreates them from the environment it sees at that moment.
  # With CACHE_ENABLED set only for the `up`, that recreate silently reverted the gateway
  # to the default (caching on) and the "no cache" baseline measured a cached system.
  export CACHE_ENABLED="${cache_enabled}"

  # Recreate the gateway replicas with the new cache setting, and start from a cold
  # Redis so the cached run cannot benefit from the previous run's entries.
  # --no-deps: only the gateway replicas need the new setting. Recreating Redis or the
  # mock provider here would also reset the counters this measurement depends on.
  docker compose up -d --force-recreate --no-deps gateway >/dev/null
  docker compose exec -T redis redis-cli FLUSHALL >/dev/null
  wait_for_gateway

  # Guard: confirm the system under test is actually in the mode we think it is. A
  # benchmark that silently measures the wrong configuration is worse than no benchmark.
  local actual
  actual="$(curl -fsS -H "x-admin-token: ${ADMIN_TOKEN}" "${GATEWAY_URL}/admin/status" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).cacheEnabled))')"
  if [[ "${actual}" != "${cache_enabled}" ]]; then
    echo "error: expected cacheEnabled=${cache_enabled} but the gateway reports ${actual}" >&2
    exit 1
  fi

  curl -fsS -X DELETE "${MOCK_URL}/__stats" >/dev/null
  local before after
  before="$(upstream_total)"

  # --no-deps: k6 must not touch the running stack it is measuring.
  # A failed k6 threshold must not abort the benchmark: the no-cache baseline is
  # *expected* to breach the latency threshold, and losing the comparison because the
  # slow case was slow would defeat the purpose. The summary file is written either way.
  docker compose --profile tools run --rm --no-deps \
    -e RUN_LABEL="${label}" \
    -e EXPECT_CACHE="${cache_enabled}" \
    k6 run "/scripts/${SCRIPT}" || log "k6 reported failing thresholds for '${label}' (continuing)"

  after="$(upstream_total)"
  echo "{\"label\":\"${label}\",\"cacheEnabled\":${cache_enabled},\"upstreamCalls\":$((after - before))}" \
    > "${RESULTS_DIR}/${label}-upstream.json"

  log "Case '${label}': $((after - before)) upstream calls"
}

log "Building and starting the stack"
docker compose up -d --build >/dev/null
wait_for_gateway

run_case "baseline-nocache" "false"
run_case "cached" "true"

log "Building comparison report"
node scripts/compare.mjs "${RESULTS_DIR}" | tee "${RESULTS_DIR}/comparison.md"

log "Done. Results in ${RESULTS_DIR}/, dashboards at http://localhost:${GRAFANA_PORT:-3001}"
