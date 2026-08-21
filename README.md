# SportsGateway

A distributed API gateway and caching layer that sits between client applications and a
third-party sports data API. It centralises the cross-cutting concerns every consumer
would otherwise re-solve: shared caching, rate limiting in both directions, fault
isolation when the provider degrades, and traffic observability.

Built to the requirements in [SportsGateway_PRD.md](SportsGateway_PRD.md).

**Every performance claim here is measured, not asserted** — 98.2% fewer upstream calls,
zero client errors during a total provider outage, near-linear scaling across replicas.
The runs behind those numbers, including the ones that produced unflattering results, are
in [RESULTS.md](RESULTS.md).

| | |
|---|---|
| **API contract** | [openapi.yaml](openapi.yaml) · live Swagger UI at `/docs` |
| **Architecture** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **Design decisions** | [docs/adr/](docs/adr/) — 7 ADRs, each with its trade-off |
| **Measured results** | [RESULTS.md](RESULTS.md) |
| **Security posture** | [SECURITY.md](SECURITY.md) |
| **Contributing** | [CONTRIBUTING.md](CONTRIBUTING.md) |

```
Client
  │
  ▼
Nginx (round-robin load balancer)
  │
  ▼
Node.js / Express gateway instances  ── stateless, scale with --scale gateway=N
  │
  ├──► Redis ── cache-aside store · token-bucket counters · stampede locks
  │
  ├──► Circuit breaker (opossum) ──► third-party sports API
  │
  └──► BullMQ queue ──► worker ──► MongoDB (request analytics)

Prometheus scrapes every instance · Grafana dashboards on top
```

## Quick start

```bash
docker compose up -d --build
curl -i localhost:8080/api/scores/215662     # X-Cache: MISS
curl -i localhost:8080/api/scores/215662     # X-Cache: HIT
```

That is the whole setup. No third-party account is needed: the stack ships a mock
provider that mimics API-Sports response shapes, so the gateway, cache, breaker and
analytics pipeline all work out of the box.

Interactive API docs are at **http://localhost:8080/docs** once the stack is up.

## Development

```bash
npm ci
npm run lint          # ESLint
npm run format        # Prettier
npm test              # 74 tests: real app, real Redis, real mock provider
npm run test:coverage # currently 93% line coverage

cd web && npm ci
npm run lint && npm run typecheck && npm test   # 20 frontend tests
```

CI runs all of the above plus an OpenAPI contract check, a Docker build, and a full-stack
smoke test that asserts a real cache MISS→HIT transition through Nginx.

## Companion UI

`web/` is a small React client that makes the gateway's behaviour demoable rather than
only provable via curl — live fixtures grouped by league, a match detail view, and a
cache-status badge on every screen showing exactly what the response envelope says
(`HIT` / `MISS` / `STALE` / `FALLBACK`, plus age). It's a client of the public API, not a
special case of it: same `/api/*` routes, same response envelope, no privileged access.
It is a secondary goal (PRD §3.3) — the gateway is still the deliverable this project is
built to demonstrate.

```bash
cd web
npm install
npm run dev              # http://localhost:5173, proxies /api to the gateway on :8080
```

Set `GATEWAY_URL` if the gateway is somewhere other than `localhost:8080` (e.g. a single
`npm start` instance on `:3000` instead of the full Docker stack behind Nginx).

On macOS without Docker Desktop, [Colima](https://github.com/abiosoft/colima) runs the
same stack headlessly — it is what the recorded results were measured on:

```bash
brew install colima docker docker-compose
mkdir -p ~/.docker/cli-plugins
ln -sfn /opt/homebrew/opt/docker-compose/bin/docker-compose ~/.docker/cli-plugins/docker-compose
colima start --cpu 6 --memory 10 --disk 40
```

| Service | URL | Notes |
|---|---|---|
| Gateway (via Nginx) | http://localhost:8080 | The only entry point clients use |
| Grafana | http://localhost:3001 | Anonymous viewer access; the SportsGateway dashboard is pre-provisioned |
| Prometheus | http://localhost:9090 | Discovers gateway replicas by DNS; `/rules` and `/alerts` show recording/alerting rule state |
| Redis exporter | http://localhost:9121/metrics | Redis's own internals, scraped independently of the gateway |
| Mock provider | http://localhost:8081 | `/__stats` counts upstream calls, `/__control` injects failures |

### Using the real provider

Get a free key from [api-football.com](https://www.api-football.com/), then in `.env`:

```bash
UPSTREAM_BASE_URL=https://v3.football.api-sports.io
UPSTREAM_API_KEY=your-key-here
```

Nothing else changes — the gateway already speaks that response format, and the outbound
rate limiter exists precisely to keep a free-tier quota intact.

### Running without Docker

```bash
npm install
redis-server --port 6379 &        # required
mongod &                          # only needed for the analytics worker
npm run mock &                    # the stand-in provider on :8081
npm start                         # gateway on :3000
npm run start:worker              # analytics worker (needs MongoDB)
```

## API

All responses carry `X-Cache`, `X-Instance` and `X-Request-Id` headers.

| Endpoint | Description | Default TTL |
|---|---|---|
| `GET /api/scores/:matchId` | One match, live or finished | 10s live, 6h once finished |
| `GET /api/fixtures/:date` | Fixtures for a date (`YYYY-MM-DD`) | 300s, 10s if any match is in play, 6h for past dates |
| `GET /api/players/:playerId?season=YYYY` | Player profile and season statistics | 1h |
| `GET /health` | Liveness | — |
| `GET /ready` | Readiness, including the Redis check | — |
| `GET /metrics` | Prometheus exposition | — |
| `GET /admin/status` | Live breaker state and effective config | — |
| `DELETE /admin/cache?route=scores` | Invalidate a route's cached entries | — |
| `DELETE /admin/cache/:route/:id` | Invalidate one entry | — |

A successful response wraps the payload with the metadata that makes caching behaviour
visible:

```json
{
  "meta": { "cache": "HIT", "ageMs": 4210, "instance": "gateway-2", "requestId": "…" },
  "data": { "match": { "matchId": 215662, "status": { "short": "FT", "finished": true }, … } }
}
```

Failures are typed rather than generic, so a client can tell a mistake of its own from a
degraded upstream:

| Status | `error.code` | Meaning |
|---|---|---|
| 400 | `bad_request` | Malformed id or date; never reaches the provider |
| 404 | `not_found` | The provider has no such match or player (cached briefly) |
| 429 | `rate_limited_inbound` | This client is over its budget |
| 429 | `rate_limited_outbound` | The shared provider quota is spent; `Retry-After` set |
| 503 | `circuit_open` | Provider is failing and no cached value exists to fall back on |
| 504 | `upstream_timeout` | Provider did not answer in time |

### `X-Cache` values

| Value | What happened |
|---|---|
| `HIT` | Served from Redis, within its freshness window |
| `STALE` | Served from Redis past its TTL, with a background refresh triggered |
| `COALESCED` | Waited on another request's in-flight upstream call instead of making its own |
| `MISS` | Fetched from the provider and cached |
| `FALLBACK` | Provider failed; served the last-known-good value (`X-Degraded: true`) |
| `BYPASS` | Caching disabled (`CACHE_ENABLED=false`), used for the load-test baseline |

## How the requirements are met

**Cache-aside with volatility-tuned TTLs.** Every cache entry carries a freshness
deadline separate from its Redis TTL, giving three zones: fresh, stale (inside the
stale-while-revalidate window), and expired-but-retained. TTL is chosen from the data
itself, not the route — a match that has finished can never change, so it caches for
hours, while a match in play expires in seconds
([`src/upstream/endpoints.js`](src/upstream/endpoints.js)).

**Stale-while-revalidate.** Past the freshness deadline, the stale value is returned
immediately and the refresh runs after the response, so no client waits on a revalidation
([`src/routes/proxy.js`](src/routes/proxy.js)).

**Stampede protection.** A cold key is guarded by a Redis `SET NX` lock. The winner calls
the provider; everyone else briefly waits for the fill and reports `COALESCED`. A test
asserts that 25 simultaneous misses on one key produce exactly one upstream call.

**Rate limiting in both directions.** A token bucket implemented as a Redis Lua script,
so the read-modify-write is atomic and shared across instances — three replicas still
enforce one limit, which per-process counters get wrong. Inbound is per client (API key,
else IP); outbound is a single global bucket sized to the provider's quota and consumed
only when a call actually leaves the gateway, so cache hits cost no quota
([`src/ratelimit/`](src/ratelimit/)).

**Circuit breaker with a real fallback.** All provider calls run through opossum. Expected
errors (bad input, 404, provider 4xx) are filtered out of the failure statistics so client
mistakes cannot trip it. When it opens, requests fail fast and are answered from the
last-known-good cache entry with `X-Degraded: true`, which is why cache entries outlive
their freshness window ([`src/upstream/breaker.js`](src/upstream/breaker.js)).

**Non-blocking analytics.** Each request is published to a BullMQ queue after the response
is sent; a separate worker process batches them into MongoDB. A slow database can never
add latency to the request path — the queue simply grows until the worker catches up
([`src/analytics/`](src/analytics/)).

**Statelessness and scaling.** No cache, counter or session data lives in process memory;
Redis holds all of it — which is what lets a request MISS on one replica and HIT on
another moments later. `docker compose up -d --scale gateway=3` adds replicas; Nginx
picks them up on `nginx -s reload`, which re-resolves the service name gracefully
(`scripts/scaling.sh` does this automatically).

**Observability.** One JSON log line per request, Prometheus metrics for request rate,
latency histograms, cache outcomes, breaker transitions and rate-limit rejections, and a
pre-provisioned Grafana dashboard (18 panels across 3 rows) with a `$route` filter variable.

Beyond the gateway's own metrics:
- **`redis-exporter`** scrapes Redis directly (memory, connected clients, engine-level
  hit rate) — an independent view of the store every cache entry, rate-limit counter and
  stampede lock actually lives in, not just the gateway's own counters about it.
- **Recording rules** (`prometheus/rules.yml`) pre-compute the hit rate, error rate, and
  p50/p95/p99 latency the dashboard reads, instead of recalculating the same PromQL on
  every panel refresh — and fix a real gotcha along the way: dividing two `rate()`
  vectors in PromQL returns *no data*, not `0`, whenever the numerator matches zero
  series (zero errors, or every request BYPASS during a cache-disabled run). Left
  unhandled, "0% errors" and "no data" render identically. The rules use `or vector(0)`
  so a genuine zero shows as zero.
- **Alerting rules** (same file) — `CircuitBreakerOpen`, `HighErrorRate`,
  `HighLatencyP95`, `LowCacheHitRate`, `GatewayInstanceDown`, `RedisTargetDown`. No
  Alertmanager is wired up (out of scope for a single-host demo), so a firing alert
  isn't routed anywhere — but it's real: visible at `/alerts`, evaluated on live data,
  and it fires. Injecting a provider failure was enough to drive `HighErrorRate` into
  `pending` state during verification.
- **Per-instance panels** — requests/s, process memory (RSS), and event-loop lag broken
  out by instance, which is the direct visual evidence that Nginx is actually spreading
  load across replicas rather than just that the replica count went up.

## Load testing

The numbers this project claims should come from measurement, not assertion. Full measured
results live in [RESULTS.md](RESULTS.md). The headlines, from runs on the containerised
stack:

| | |
|---|---|
| Upstream API calls under burst load | **98.2% fewer** (85,676 → 1,514) |
| Cache hit rate | **99.83%** |
| p95 latency, cache hit | **0.8 ms** (from 119.8 ms uncached) |
| Client errors during a total provider outage | **0**, with 2,551 requests served from fallback cache |
| Throughput at 1 / 2 / 3 replicas (0.4 CPU each) | **2,746 / 6,067 / 7,249 req/s** |
| Request events written to MongoDB, all status 200 | **5,417,810** |

Without Docker — needs only Node and a local Redis:

```bash
npm run benchmark:local -- --duration 30 --concurrency 60
```

It starts the mock provider and a gateway, runs the same load with caching off and then
on, and writes `results/local-comparison.md`. It reports upstream calls per 1,000 client
requests rather than a raw count, because the two runs do not serve identical request
volumes and the raw count would overstate the effect.

With Docker, the full stack including Nginx, replicas and k6:

```bash
./scripts/benchmark.sh          # caching before/after, ~15 min
./scripts/scaling.sh            # throughput at 1, 2 and 3 replicas, ~10 min
./scripts/failure.sh            # provider outage mid-load, ~4 min
./scripts/benchmark.sh --quick  # 30s per case, to check the plumbing first
```

`scaling.sh` caps each replica at 0.4 CPU (`GATEWAY_CPUS`) before measuring. Without a cap
the result is flat and says nothing: a single replica answers cache hits in about 10 ms, so
100 virtual users are capped near 10k req/s by their own concurrency and never saturate the
gateway. Constraining the instance is what makes an added replica measurable. It also
verifies, per step, that Nginx is really spreading traffic over the expected number of
replicas, and aborts if not.

All three benchmark scripts disable the rate limiters for the duration of the run. Left on,
the outbound limiter would cap the no-cache baseline at the provider quota and the
comparison would be measuring the limiter instead of the cache; the inbound limiter,
shared across instances through Redis, would cap total throughput no matter how many
replicas were running and hide the scaling effect entirely.

`benchmark.sh` runs the identical live-match burst twice — once with `CACHE_ENABLED=false`
and once with caching on — flushing Redis between runs so the cached run starts cold. The
upstream call counts are read from the mock provider's own request counter rather than
from the gateway's metrics, so the headline number cannot be flattered by gateway-side
accounting. Results land in `results/` and are summarised into
[RESULTS.md](RESULTS.md) via `scripts/compare.mjs`.

Individual scenarios:

```bash
docker compose --profile tools run --rm k6 run /scripts/burst.js     # live-match burst
docker compose --profile tools run --rm k6 run /scripts/failure.js   # provider outage mid-test
docker compose --profile tools run --rm k6 run /scripts/scaling.js   # saturating throughput
```

To watch degradation by hand, drive the mock provider directly:

```bash
curl -X POST localhost:8081/__control -H 'content-type: application/json' -d '{"mode":"error"}'
curl -i localhost:8080/api/scores/215662     # X-Cache: FALLBACK, X-Degraded: true
curl -X POST localhost:8081/__control -H 'content-type: application/json' -d '{"mode":"healthy"}'
```

## Tests

```bash
npm test    # needs a Redis on localhost:6379, or set TEST_REDIS_URL
```

65 tests covering the transforms, the token bucket (including that concurrent consumers
cannot oversubscribe it), the cache freshness zones and locking, the analytics pipeline
end to end over a real BullMQ queue, and gateway behaviour: cache hit/miss, negative
caching, stale-while-revalidate, stampede coalescing, both rate limiters, breaker
trip/fallback/recovery, and the observability endpoints. The end-to-end tests drive the
real Express app against a real Redis and the real mock provider, so they exercise the
shipped wiring rather than a stand-in for it.

## Configuration

Everything is environment-driven; see [.env.example](.env.example) for the full list with
defaults. The values worth knowing:

| Variable | Default | Purpose |
|---|---|---|
| `CACHE_ENABLED` | `true` | `false` gives the no-cache load-test baseline |
| `CACHE_TTL_SCORES_S` | `10` | Freshness window for a live match |
| `CACHE_TTL_FINISHED_S` | `21600` | Freshness window once a match is over |
| `CACHE_SWR_WINDOW_S` | `30` | How long a stale value may be served while refreshing |
| `CACHE_FALLBACK_TTL_S` | `3600` | How long an entry is retained for breaker-open fallbacks |
| `RL_INBOUND_CAPACITY` | `600` | Per-client burst allowance |
| `RL_OUTBOUND_CAPACITY` | `100` | Shared provider quota, across all instances |
| `BREAKER_ERROR_THRESHOLD_PCT` | `50` | Failure rate that opens the circuit |
| `BREAKER_RESET_TIMEOUT_MS` | `10000` | How long before a half-open probe |
| `GATEWAY_REPLICAS` | `2` | Gateway instances started by `docker compose up` |

## Repository map

```
src/
  app.js, container.js, index.js   Express wiring, dependency graph, server bootstrap
  worker.js                        Analytics worker entry point
  cache/                           Cache-aside store, freshness zones, stampede locks
  ratelimit/                       Token bucket (Lua), inbound middleware, outbound guard
  upstream/                        HTTP client, circuit breaker, endpoint descriptors, transforms
  routes/                          Proxy route factory, health/metrics, admin
  middleware/                      Request context and observability, error handling
  analytics/                       Queue producer, event schema, Mongo writer, batching worker
mock-upstream/                     Stand-in provider with failure injection and call counting
k6/                                Load-test scenarios (burst, failure injection, scaling)
scripts/                           Benchmark orchestration, local no-Docker benchmark, reports
nginx/ prometheus/ grafana/        Load balancer and observability configuration
test/                              65 unit and end-to-end tests
```

## Known trade-offs

- **Cache staleness during live matches.** A 10s TTL means a score can be up to 10
  seconds behind, and stale-while-revalidate can extend that to 40s under the default
  window. This is a deliberate freshness-for-load trade; tighten `CACHE_TTL_SCORES_S` to
  reverse it.
- **Rate limiters fail open.** If Redis is unreachable, requests are allowed rather than
  rejected, on the grounds that a limiter outage should not become a gateway outage. The
  gap is logged at error level.
- **Nginx needs a reload after a scale change.** The `upstream` block resolves the
  gateway replicas when the config loads, so new replicas only receive traffic after
  `nginx -s reload` (graceful, no dropped connections). The alternative — a variable in
  `proxy_pass`, which re-resolves per request — removes that step but has no keepalive
  pool, and measurement showed why that matters: at a few thousand requests per second
  the per-request connections exhausted Nginx's ephemeral ports and produced a 44% error
  rate while the gateway itself was still healthy. Connection reuse won.
- **Single-host scope.** Multi-region deployment and managed orchestration are explicit
  non-goals in the PRD.
