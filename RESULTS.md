# Load test results

Two levels of measurement exist in this repo:

1. **Local benchmark** — a single gateway process, no Nginx and no replicas, driven by
   `scripts/local-benchmark.mjs`. Needs only Node and Redis. **Measured, below.**
2. **Full stack benchmark** — Nginx, multiple gateway replicas, the analytics worker and
   k6, driven by `scripts/benchmark.sh`, `scripts/scaling.sh` and `scripts/failure.sh`.
   Needs Docker. **Measured 2026-08-19, below.**

Every number on this page came out of a run; none is an estimate. The environment was
Colima on macOS with 6 CPUs and 10 GB of memory, with k6 driving load from inside the
compose network, and the whole stack — Nginx, gateway replicas, Redis, MongoDB, the
analytics worker, Prometheus and Grafana — competing for those same 6 cores. That
constraint shapes the scaling result in section 3 and is discussed there rather than
hidden.

## 1. Local benchmark — caching before and after

Measured 2026-08-19. Single gateway process, 60 concurrent clients with 60ms think time,
30s per case, against the bundled mock provider (which adds ~80ms of latency per call to
approximate a real third-party API). Both runs are identical except for `CACHE_ENABLED`,
and each starts from a cold Redis. Rate limiters are disabled in both runs so the
comparison isolates caching rather than measuring the limiter.

| Metric | No cache | With cache |
|---|---|---|
| Client requests served | 13,594 | 56,048 |
| Throughput (req/s) | 451.0 | 1,864.8 |
| Upstream API calls | 13,594 | 296 |
| Upstream calls per 1,000 client requests | 1,000.0 | 5.3 |
| Latency p50 | 102.8 ms | 2.0 ms |
| Latency p95 | 121.0 ms | 3.2 ms |
| Latency p99 | 123.1 ms | 6.2 ms |
| Failed requests | 0% | 0% |

**Headline numbers**

- **99.5% fewer provider calls per client request** — 1,000 per 1,000 requests without
  caching, 5.3 per 1,000 with it.
- **Cache hit rate 99.7%** under burst load (PRD target: ≥70%).
- **p95 latency reduced 97.3%**, from 121.0 ms to 3.2 ms (PRD target for a cache hit:
  <50 ms).
- **4.1x throughput** at identical concurrency, 451 to 1,865 req/s.

Cache outcome breakdown with caching on: 55,508 `HIT`, 283 `STALE` (served instantly
while refreshing in the background), 67 `COALESCED` (waited on another request's upstream
call rather than making a duplicate), 190 `MISS`.

**Reading these honestly.** The absolute upstream call reduction (13,594 to 296) overstates
the effect on its own, because the cached run also served four times more requests in the
same window. The per-1,000-requests ratio is the volume-invariant comparison and is the
number to quote. The hit rate is high because burst traffic concentrates on eight live
matches — that concentration is the realistic case this gateway exists for, but a flatter
key distribution would produce a lower rate.

## 2. Full stack — caching before and after

**Measured 2026-08-19** on the containerised stack (Nginx, 2 gateway replicas, Redis,
MongoDB, analytics worker) running under Colima with 6 CPUs and 10 GB, driven by k6 from
inside the compose network. The scenario ramps to 100 virtual users, holds for 5 minutes
and ramps down, with traffic concentrated on eight in-play matches. Both runs are
identical except for `CACHE_ENABLED`, each starts from a flushed Redis, and the upstream
call counts come from the provider's own request counter.

```bash
docker compose up -d --build
./scripts/benchmark.sh          # ~15 min
```

| Metric | No cache | With cache |
|---|---|---|
| Client requests served | 85,678 | 114,449 |
| Throughput (req/s) | 219.5 | 293.3 |
| Upstream API calls | 85,676 | 1,514 |
| Upstream calls per 1,000 client requests | 999.98 | 13.2 |
| Cache hit rate | 0.00% | 99.83% |
| Latency p50 | 101.8 ms | 0.4 ms |
| Latency p95 | 119.8 ms | 0.8 ms |
| Failed requests | 0.00% | 0.00% |

**Headline numbers**

- **98.2% fewer calls to the provider** — 85,676 down to 1,514 — while serving *more*
  client traffic (114,449 requests versus 85,678).
- **98.7% fewer provider calls per client request**, the volume-invariant form of the
  same result: 13.2 per 1,000 requests against a baseline of essentially 1,000.
- **Cache hit rate 99.83%** under burst load, against a PRD target of ≥70%.
- **p95 latency 119.8 ms → 0.8 ms** (99.3% lower); p50 101.8 ms → 0.4 ms.

**Reading these honestly.** The baseline made 85,676 upstream calls for 85,678 requests —
almost exactly 1:1, which is the check that confirms caching really was off rather than
the run having been misconfigured. The throughput figures are *not* a capacity ceiling:
both runs are bounded by the scenario's think time, so the 219 → 293 req/s difference
reflects removed upstream latency rather than the system's maximum. Section 3 measures
capacity properly, with no think time. The hit rate is very high because burst traffic
concentrates on a few live matches — the case this gateway exists for — and a flatter key
distribution would produce a lower number.

## 3. Horizontal scaling

```bash
./scripts/scaling.sh            # ~10 min
```

Each step runs 100 virtual users with no think time for two minutes, so the number
reported is a saturation throughput rather than a rate the script chose. Before measuring,
the script verifies that Nginx is actually distributing across the expected number of
replicas and aborts if not — an earlier run silently measured two replicas while claiming
one, and this guard exists because of it.

**Measured 2026-08-19, each replica capped at 0.4 CPU:**

| Gateway replicas | Throughput (req/s) | Speedup | p50 | p95 | Failed |
|---|---|---|---|---|---|
| 1 | 2,746 | 1.00x | 13.2 ms | 87.0 ms | 0.00% |
| 2 | 6,067 | 2.21x | 8.0 ms | 56.2 ms | 0.00% |
| 3 | 7,249 | 2.64x | 6.3 ms | 49.1 ms | 0.00% |

Throughput rises and latency falls monotonically as replicas are added, with no failed
requests at any step — which is the property the stateless design exists to provide.
Two honest caveats about the shape of that curve:

- **2 replicas returns 2.21x, better than linear.** This reflects how badly the single
  replica was queued rather than any superlinear magic: at 1x, p95 was 87 ms against a
  p50 of 13 ms, so most of the wait was backlog. Relieving that backlog recovers more
  than a proportional share.
- **3 replicas returns 2.64x, short of linear.** Nginx, Redis, the load generator and
  three replicas all share the same 6-core host, so the third replica competes for CPU
  with the rest of the stack. Sub-linear at this point is the expected result on one box.

**The uncapped run, and why the cap is there.** Run without a CPU limit, the same test
produced a flat line — 8,580, 9,178 and 8,292 req/s for one, two and three replicas:

| Gateway replicas | Throughput (req/s) | Speedup | p50 | p95 |
|---|---|---|---|---|
| 1 | 8,580 | 1.00x | 11.2 ms | 15.2 ms |
| 2 | 9,178 | 1.07x | 9.5 ms | 21.2 ms |
| 3 | 8,292 | 0.97x | 10.4 ms | 22.7 ms |

That flatness is not a defect in the gateway, and reading it as one would be a mistake.
p50 stayed near 10 ms at every replica count, meaning the gateway was never saturated: with
concurrency fixed at 100 virtual users and a ~10 ms service time, Little's law caps
throughput near 10k req/s no matter how many replicas are running. The load generator's
concurrency was the binding constraint, so extra replicas had no queue to drain. Capping
each replica at 0.4 CPU makes the instance the bottleneck again, which is the only
condition under which "what does one more instance buy?" has a meaningful answer.

## 4. Upstream failure behaviour

```bash
./scripts/failure.sh            # ~4 min
```

Fifty virtual users drive steady traffic for three minutes. Sixty seconds in, the provider
is forced to fail every request; sixty seconds after that it is restored. The question is
what a *client* experiences while the provider is down.

**Measured 2026-08-19** — 43,832 requests at 240 req/s:

| Observation | Value |
|---|---|
| Requests served from last-known-good cache during the outage | 2,551 |
| Responses flagged degraded (`X-Degraded: true`) | 2,551 |
| **5xx returned to clients** | **0** |
| **Failed requests** | **0.00%** |
| Served stale while revalidating | 3,652 |
| Cache hits / misses | 40,576 / 243 |
| Latency p50 / p95 / p99 | 1.7 ms / 7.6 ms / 119.3 ms |
| Worst single request | 429.8 ms |

**Not one client request failed during a total provider outage.** Every request was
answered, 2,551 of them from the last known good cached value with `X-Degraded: true` so
a consumer can tell fresh data from fallback. The worst request in the entire run took
430 ms — there is no hanging, because an open circuit never dials a dead provider.

**Breaker behaviour, read from Prometheus rather than inferred:**

| Signal | Value |
|---|---|
| Transitions to open | 12 |
| Transitions to half-open | 12 |
| Transitions to closed | 2 |
| Upstream calls that got a 503 | 37 |
| Breaker state after recovery | 0 (closed) on every replica |

The state timeline tracks the injection exactly: closed until 10:49:55, tripped within
~15 s of the outage starting at 10:49:40, and closed again by 10:50:55 after the provider
recovered at 10:50:40. The repeated open → half-open cycling is correct opossum behaviour,
not thrash: each time the reset timeout elapses the breaker half-opens, sends one probe,
finds the provider still dead, and re-opens.

The most telling number is **37**. Only 37 requests reached the failing provider across
the whole outage while 43,832 client requests were served — the breaker absorbed the
failure instead of forwarding it 43,832 times. Note also that each replica runs its own
breaker (12 transitions across 2 replicas, 6 cycles each): breaker state is deliberately
per-instance, since it reflects what *that* process observes about upstream health.

Breaker behaviour itself is covered by automated tests: the circuit opens under sustained
upstream failure, requests then fail fast (asserted under 200 ms rather than waiting on
the upstream timeout), cached values are served with `X-Degraded: true`, and the circuit
closes again once the provider recovers.

## 5. Analytics pipeline

The BullMQ queue and the MongoDB writer ran throughout every load test above. After all
runs, MongoDB holds **5,417,810 request events**, written by the worker rather than on the
response path:

| Cache status | Events |
|---|---|
| HIT | 5,287,408 |
| BYPASS (the caching-disabled baseline) | 85,931 |
| STALE (served stale while revalidating) | 34,509 |
| NONE (health checks and similar) | 3,542 |
| FALLBACK (served during the provider outage) | 2,551 |
| MISS | 2,254 |
| COALESCED (stampede protection) | 1,613 |

| Breaker state at time of request | Events |
|---|---|
| closed | 5,403,589 |
| open | 13,956 |
| halfOpen | 264 |

Three things are worth drawing out of that table:

- **Every one of the 5,417,810 events has status 200.** Across the entire campaign —
  burst load, saturation, a total provider outage — not one client received an error.
- **FALLBACK is 2,551, exactly matching the 2,551 that k6 counted client-side.** These are
  independent measurement paths: k6 counts response headers it received, MongoDB counts
  what the gateway asynchronously logged. They agree exactly, which is good evidence that
  neither the analytics pipeline nor the k6 accounting is dropping events.
- **COALESCED is 1,613**, so cache-stampede protection genuinely engaged under real
  concurrency rather than only in its unit test — 1,613 requests waited on an in-flight
  refresh instead of each launching their own upstream call.

All six indexes were created by the worker on startup, including the TTL index
(`expireAfterSeconds: 604800`) that ages events out after seven days. The queue kept up
with roughly 300 req/s sustained without backing up, and the gateway's own latency
(p95 0.8 ms on cache hits) shows the logging never entered the response path.

## 6. Rate limiting

The load tests above run with the limiters disabled on purpose, so they were checked
separately against the live stack at its default compose configuration (inbound capacity
600, refill 200/s per client):

```
900 requests, 100 in parallel, from one client IP
  845  HTTP 200
   55  HTTP 429
```

Rejected requests carry the headers a client needs to back off correctly:

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 0
Retry-After: 1
```

The bucket refills as specified rather than locking out for a fixed window — an earlier
check of 70 sequential requests passed entirely, because at 200 tokens/s the bucket refills
faster than sequential curl calls can drain it. That is correct token-bucket behaviour, and
worth stating because "no 429s appeared" can easily be misread as a broken limiter.

## 7. Observability

Prometheus and Grafana were verified live rather than assumed to work:

- Prometheus discovers gateway replicas by DNS and scrapes them — all targets `health=up`,
  with replicas appearing and disappearing as the stack is scaled.
- Grafana starts with the Prometheus datasource and the SportsGateway dashboard already
  provisioned (`uid=sportsgateway`); no manual setup.
- **Every panel query was executed against Prometheus and returns live data** — cache hit
  rate, breaker state, instances up, request rate by route, p50/p95/p99 latency, and
  client-requests-versus-upstream-calls. The breaker timeline in section 4 was read out of
  Prometheus this way.

One caveat worth knowing before reading a dashboard right after scaling: an instant query
such as "instances up" counts series that Prometheus has not yet marked stale, so for
about five minutes after replicas are removed it can over-report — 4 instances were
reported while 2 were running. The metric is correct; the staleness window is the
explanation.

Dashboard screenshots are the one artifact not captured here: rendering PNGs server-side
needs Grafana's image-renderer plugin, which is not installed. The dashboard is live at
`http://localhost:3001` while the stack is up, and the underlying values are recorded above.

## 8. Targets from the PRD

| Metric | Target | Result |
|---|---|---|
| Cache hit rate under burst load | ≥ 70% | **99.83%** ✅ |
| p95 latency on a cache hit | < 50 ms | **0.8 ms** ✅ |
| Upstream call reduction | measured, no preset target | **98.2% fewer** (98.7% per request) ✅ |
| Behaviour when upstream is down | breaker trips, cached response served, no hang | **0 client errors, 2,551 fallback responses, worst request 430 ms** ✅ |
| Horizontal scaling | near-linear throughput per instance | **2.21x at 2 replicas, 2.64x at 3** ✅ (sub-linear at 3 — single 6-core host, see section 3) |

Local single-process figures, for reference: 99.7% hit rate, 3.2 ms p95, 99.5% fewer
upstream calls per request.
