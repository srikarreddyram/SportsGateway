#!/usr/bin/env bash
#
# Milestone 9 — upstream failure scenario.
#
# Drives steady traffic while the provider is forced to fail mid-test, then recovered.
# The question being answered is what a client experiences during a provider outage:
# the circuit breaker should trip and requests should be served from the last known good
# cache entry quickly, instead of every request hanging on a dead upstream.
#
#   ./scripts/failure.sh          # ~3 minutes
set -euo pipefail

cd "$(dirname "$0")/.."

# Rate limiting is off for the same reason as in benchmark.sh: k6 drives all traffic from
# a single container, so one source IP would trip the per-client inbound limiter and the
# run would measure the limiter rather than the breaker. The outbound limiter is off so
# that upstream failures reach the breaker instead of being rejected before they get there.
export RL_INBOUND_ENABLED=false
export RL_OUTBOUND_ENABLED=false

GATEWAY_PORT="${GATEWAY_PORT:-8080}"
GATEWAY_URL="http://localhost:${GATEWAY_PORT}"
MOCK_URL="http://localhost:${MOCK_PORT:-8081}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

wait_for_gateway() {
  for _ in $(seq 1 60); do
    if curl -fsS "${GATEWAY_URL}/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "error: gateway did not become ready" >&2
  exit 1
}

log "Starting the stack at default replica count"
docker compose up -d --force-recreate >/dev/null
wait_for_gateway
docker compose exec -T nginx nginx -s reload
sleep 3

log "Clearing cache and restoring the provider to healthy"
docker compose exec -T redis redis-cli FLUSHALL >/dev/null
curl -fsS -X POST "${MOCK_URL}/__control" \
  -H 'content-type: application/json' \
  -d '{"mode":"healthy","errorRate":0}' >/dev/null

log "Running the outage scenario (~3 min)"
# --no-deps so compose does not restart the stack that is being measured.
docker compose --profile tools run --rm --no-deps \
  -e RUN_LABEL=failure \
  k6 run /scripts/failure.js || log "k6 reported failing thresholds (continuing)"

log "Restoring the provider to healthy"
curl -fsS -X POST "${MOCK_URL}/__control" \
  -H 'content-type: application/json' \
  -d '{"mode":"healthy","errorRate":0}' >/dev/null

log "Done. Summary written to results/failure-summary.json"
