# Architecture

How a request actually flows, and where each guarantee is enforced. Decisions and their
trade-offs live in [docs/adr/](adr/); measured behaviour lives in [RESULTS.md](../RESULTS.md).

## Request path

```
Client
  │
  ▼
Nginx  ── round-robin across replicas, keepalive pool to each  (ADR 0005)
  │
  ▼
Gateway replica (stateless)
  │
  ├─ helmet + cors                     security headers, origin policy
  ├─ request context                   request id, timing, analytics event
  ├─ inbound rate limit                per-client token bucket in Redis   (ADR 0002)
  │
  ├─ cache lookup ───────────────► Redis
  │     FRESH  → return HIT
  │     STALE  → return STALE, refresh in background                      (ADR 0001)
  │     MISS   → single-flight lock, one caller proceeds
  │
  ├─ outbound rate limit               global quota bucket, shared        (ADR 0002)
  ├─ circuit breaker                   per-instance opossum               (ADR 0003)
  │     open → serve last-known-good cache as FALLBACK, X-Degraded: true
  │
  ▼
Third-party provider (or the bundled mock)                                (ADR 0006)
```

Analytics leaves the response path entirely: the handler publishes to a BullMQ queue and
returns, and a separate worker batches into MongoDB (ADR 0004).

## Where each guarantee lives

| Guarantee                   | Enforced by                         | Shared across replicas?                          |
| --------------------------- | ----------------------------------- | ------------------------------------------------ |
| Cached responses            | `src/cache/index.js` + Redis        | Yes — a MISS on one replica is a HIT on the next |
| No cache stampede           | Single-flight lock in Redis         | Yes                                              |
| Per-client fairness         | `src/ratelimit/inbound.js`          | Yes — one budget, not one per replica            |
| Provider quota safety       | `src/ratelimit/outbound.js`         | Yes                                              |
| Fail fast on a bad provider | `src/upstream/breaker.js`           | **No** — deliberately per-instance (ADR 0003)    |
| Graceful degradation        | `src/routes/proxy.js` fallback path | Follows the cache, so yes                        |
| Request analytics           | BullMQ queue → worker → MongoDB     | Yes                                              |

The one deliberate exception is the circuit breaker. Everything else is shared state in
Redis, which is what makes replicas interchangeable and the gateway horizontally scalable.

## Statelessness

No cache entry, counter, lock or session lives in process memory. That is the property
that makes `--scale gateway=N` work at all: replicas can be added or removed at any time,
and any replica can serve any request identically.

It is also directly observable rather than asserted — every response carries `X-Instance`,
and `scripts/scaling.sh` samples that header to verify traffic is genuinely reaching the
expected number of replicas before it records a measurement.

## Freshness zones

A cache entry passes through three states, which is what lets one mechanism serve both
stale-while-revalidate and outage fallback:

```
     written                freshUntil            freshUntil + swrWindow        Redis TTL
        │                       │                          │                        │
        ├───────── FRESH ───────┼────────── STALE ─────────┼─────── EXPIRED ────────┤
        │                       │                          │                        │
     serve HIT            serve STALE +              value still in Redis:      key gone
                        refresh in background      available as FALLBACK
                                                    if upstream is down
```

The Redis TTL is deliberately longer than freshness + stale window. An entry nobody would
serve as fresh is still the best available answer when the provider is down — which is
exactly what produced 2,551 fallback responses and zero client errors during the injected
outage.

## Failure behaviour

| Failure           | What happens                                 | Client sees                                 |
| ----------------- | -------------------------------------------- | ------------------------------------------- |
| Provider slow     | Breaker timeout, then fallback to cache      | Cached data, `X-Degraded: true`             |
| Provider erroring | Breaker opens after threshold, stops calling | Cached data, or typed 503 if nothing cached |
| Provider recovers | Half-open probe succeeds, breaker closes     | Fresh data resumes automatically            |
| Redis down        | Cache misses; rate limiters **fail open**    | Slower responses, still served (ADR 0002)   |
| MongoDB down      | Analytics events queue up                    | Nothing — logging is off the response path  |
| A replica dies    | Nginx `max_fails` routes around it           | Nothing — other replicas serve              |

The consistent principle: degrade the non-essential before failing the request. Analytics
loss, rate-limit enforcement and data freshness are all sacrificed before a client gets an
error.

## Observability

Three layers, each answering a different question:

- **Structured logs** (pino, JSON) — what happened on one specific request.
- **Prometheus metrics** — what is happening in aggregate right now. Recording rules
  pre-compute the ratios the dashboard reads; alerting rules cover breaker-open, error
  rate, latency, hit rate, and instance/Redis availability.
- **MongoDB analytics** — what happened historically, queryable after the fact. This is
  how "cache hits vs misses per endpoint over the whole campaign" gets answered.

Redis is scraped independently via `redis_exporter`, so the store's own health is visible
rather than only the gateway's opinion of it.
