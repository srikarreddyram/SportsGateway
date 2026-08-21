#!/usr/bin/env bash
#
# Milestone 9 — horizontal scaling validation.
#
# Runs the same saturating load against 1, 2 and 3 gateway replicas behind Nginx and
# records throughput at each step. Because the gateway keeps no state in memory, adding
# replicas should move throughput close to linearly.
#
#   ./scripts/scaling.sh          # 2 minutes per step
#   ./scripts/scaling.sh 1m       # custom duration per step
set -euo pipefail

cd "$(dirname "$0")/.."

# Both limiters are shared across instances through Redis, so leaving them on would cap
# total throughput at the same ceiling no matter how many replicas are running — which
# would hide exactly the effect this test exists to measure.
export RL_INBOUND_ENABLED=false
export RL_OUTBOUND_ENABLED=false

# Cap each replica's CPU so that adding a replica adds real capacity to measure.
# Without a cap on this 6-core host the result is flat and uninformative: a single
# replica already answers cache hits in ~10ms, so 100 virtual users are throughput-capped
# near 10k req/s by their own concurrency (Little's law) and never saturate the gateway.
# Constraining the instance is what makes "what does one more instance buy?" answerable.
export GATEWAY_CPUS="${GATEWAY_CPUS:-0.4}"
# Enough concurrency to keep the constrained replicas saturated. 100 virtual users
# already backs up a 0.4-CPU replica (p95 87ms at one replica), which is the condition
# the measurement needs; this is the value the recorded results were produced with.
export VUS="${VUS:-100}"

DURATION="${1:-2m}"
GATEWAY_PORT="${GATEWAY_PORT:-8080}"
GATEWAY_URL="http://localhost:${GATEWAY_PORT}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

wait_for_gateway() {
  for _ in $(seq 1 60); do
    if curl -fsS "${GATEWAY_URL}/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "error: gateway did not become healthy" >&2
  exit 1
}

log "Starting the stack"
docker compose up -d --build >/dev/null

for replicas in 1 2 3; do
  log "Scaling to ${replicas} gateway replica(s)"
  docker compose up -d --scale "gateway=${replicas}" >/dev/null
  sleep 5
  wait_for_gateway

  # Nginx resolves the gateway replicas when it loads its config, so it must be told to
  # re-read after a scale change. A reload is graceful — existing connections finish on
  # the old workers — and it is what makes the new replicas receive traffic.
  docker compose exec -T nginx nginx -s reload
  sleep 3

  # Confirm the load balancer really is spreading across the expected number of replicas
  # before measuring. A scaling test that silently ran against the wrong replica count
  # would produce a plausible-looking but meaningless curve.
  seen="$(for _ in $(seq 1 40); do curl -fsS -D - -o /dev/null "${GATEWAY_URL}/health" | awk '/^[Xx]-[Ii]nstance:/ {print $2}'; done | tr -d '\r' | sort -u | wc -l | tr -d ' ')"
  log "Load balancer is reaching ${seen} distinct instance(s); expected ${replicas}"
  if [[ "${seen}" != "${replicas}" ]]; then
    echo "error: expected traffic to reach ${replicas} replica(s) but saw ${seen}" >&2
    exit 1
  fi

  docker compose exec -T redis redis-cli FLUSHALL >/dev/null

  # --no-deps: without it, `compose run` starts k6's dependencies and resets the gateway
  # to the compose file's default replica count, silently undoing the scaling above.
  docker compose --profile tools run --rm --no-deps \
    -e RUN_LABEL="scaling-${replicas}x" \
    -e GATEWAY_REPLICAS="${replicas}" \
    -e DURATION="${DURATION}" \
    k6 run /scripts/scaling.js || log "k6 reported failing thresholds for ${replicas}x (continuing)"
done

log "Rebuilding the comparison report"
node scripts/compare.mjs results | tee results/comparison.md

log "Done. Scaling summaries are in results/scaling-*.json"
