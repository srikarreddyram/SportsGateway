# Product Requirements Document: SportsGateway

**Distributed API Gateway & Caching Layer for Sports Data Services**

| | |
|---|---|
| **Owner** | Ramachandra Tejsrikar Reddy |
| **Status** | Planning |
| **Version** | 1.0 |
| **Last Updated** | August 18, 2026 |

---

## 1. Overview

SportsGateway is a distributed API gateway that sits between client applications and a live, third-party sports data API. It centralizes cross-cutting backend concerns — rate limiting, caching, fault tolerance, and traffic observability — into a single, horizontally scalable service layer, rather than leaving each client or downstream consumer to solve these problems independently.

The project is built as a portfolio-grade demonstration of backend systems and distributed systems engineering: request routing, distributed caching, graceful degradation under upstream failure, and horizontal scaling under real (not simulated) traffic conditions.

## 2. Problem Statement

Sports data — live scores, fixtures, player stats — is bursty and unevenly distributed by nature. A handful of live matches can generate a disproportionate share of traffic in short windows, while most endpoints stay quiet. Consuming a third-party API directly, without a mediating layer, creates several concrete problems:

- **Upstream quota exhaustion.** Third-party sports APIs (even paid tiers) enforce rate limits. Uncontrolled client traffic can exhaust quota during exactly the moments — live matches — when data is most needed.
- **No shared caching.** Every client re-fetching the same live match state independently multiplies load on the upstream API for data that hasn't changed.
- **No fault isolation.** If the upstream API slows down or errors, naive proxying means every client request hangs or fails in lockstep, with no fallback behavior.
- **No visibility.** Without centralized logging, there's no way to see which endpoints spike, when, or by how much — making capacity planning and rate-limit tuning guesswork.

## 3. Goals

### 3.1 Primary Goals
- Reduce upstream API call volume during high-traffic windows through caching, without serving unacceptably stale data.
- Prevent upstream outages or slowdowns from cascading into gateway-wide failure.
- Demonstrate horizontal scalability — the system should tolerate adding/removing gateway instances with no state loss or behavior change.
- Produce real, measurable performance data (cache hit rate, latency, upstream call reduction) via load testing, rather than theoretical claims.

### 3.2 Non-Goals
- Building or maintaining the underlying sports data itself — the project consumes an existing, documented third-party API rather than sourcing data independently.
- Multi-region deployment or production-grade cloud infrastructure (e.g., managed Kubernetes, multi-AZ failover). Scope is a single-host, containerized environment sufficient to demonstrate the architecture.
- Treating the companion UI (Section 3.3) as the product. It exists to make the gateway's behavior demonstrable, not to compete with real sports-data products on breadth of coverage, account features, or content licensing.

### 3.3 Companion UI (secondary goal)
A small React client, visually inspired by consumer live-scores apps (dense match cards,
a dark theme, a persistent live indicator), that consumes SportsGateway's public endpoints
exactly as any other client would — no privileged access to internals. Its purpose is to
make the gateway's behavior (cache freshness, degraded/fallback responses, live-match
updates) visible and demoable rather than only provable via curl and load-test numbers.
It ships under SportsGateway's own name and branding; it takes layout/interaction
inspiration from existing sports apps but does not use any other product's name, logo, or
brand assets. The gateway remains the primary deliverable — the UI is judged by whether it
showcases the gateway's guarantees, not by its own feature completeness.

## 4. Success Metrics

| Metric | Target |
|---|---|
| Cache hit rate during simulated live-match load | ≥ 70% |
| Reduction in upstream API calls vs. no-cache baseline | Measured and reported (no pre-set target — real number from load test) |
| p95 gateway response latency (cache hit) | < 50ms |
| p95 gateway response latency (cache miss, upstream healthy) | < upstream's own latency + < 20ms overhead |
| Behavior when upstream is forced down | Circuit breaker trips; gateway returns fallback/cached response instead of hanging or 500ing |
| Horizontal scaling | Adding a second/third gateway instance shows near-linear throughput increase under load test |

## 5. System Architecture

```
Client
  │
  ▼
Nginx (load balancer, round-robin)
  │
  ▼
Node.js / Express Gateway instances (stateless, horizontally scaled)
  │
  ├──► Redis  — cache-aside store, rate-limit counters, stale-while-revalidate state
  │
  ├──► Circuit Breaker (opossum) ──► Third-Party Sports API (API-Sports / SportsRadar)
  │
  └──► BullMQ (Redis-backed queue) ──► async worker ──► MongoDB (request/analytics logs)
```

### 5.1 Component Responsibilities

**Nginx (Load Balancer)**
Distributes incoming client requests across gateway instances. Enables the horizontal scaling story — instances can be added/removed without client-visible disruption, since no session state lives on any individual instance.

**Node.js / Express Gateway**
Stateless request handler. Responsible for: validating incoming requests, checking cache before calling upstream, enforcing rate limits, invoking the circuit breaker for upstream calls, and enqueuing analytics events. Statelessness is enforced by design — no in-memory session, rate-limit, or cache data; everything shared lives in Redis.

**Redis**
Serves three distinct purposes, kept logically separated by key namespace:
1. **Cache-aside store** for upstream responses (e.g., `match:{id}:score`), with TTLs tuned to data volatility.
2. **Rate-limit counters** (sliding window or token bucket) for two independent directions: inbound (per-client limits on the gateway) and outbound (protecting the gateway's own quota with the upstream API).
3. **Stale-while-revalidate markers**, tracking which cached keys are being asynchronously refreshed so concurrent requests don't trigger duplicate upstream calls (cache stampede protection).

**Circuit Breaker (opossum)**
Wraps all outbound calls to the upstream sports API. Trips to an open state after a configurable failure/timeout threshold, causing subsequent requests to fail fast (serving stale cache or a fallback response) instead of piling up on a degraded upstream. Half-open state periodically tests upstream recovery.

**BullMQ + MongoDB**
Request metadata (endpoint, client, latency, cache hit/miss, timestamp) is pushed to a Redis-backed queue rather than written synchronously, so analytics logging never adds latency to the client-facing response path. A separate worker process consumes the queue and writes to MongoDB.

**Third-Party Sports API**
An external, documented, officially supported sports data provider (API-Sports or SportsRadar free tier). Chosen deliberately over undocumented/internal endpoints of consumer sites to keep the project's data sourcing unambiguous and resume-safe.

## 6. Detailed Functional Requirements

### 6.1 Caching
- Cache-aside pattern: on a cache miss, the gateway fetches from upstream, stores the response in Redis, then returns it.
- TTLs differentiated by data volatility: short TTL (5–10s) for live match state, long TTL (hours) for completed matches/fixtures that won't change.
- Stale-while-revalidate: on TTL expiry, the gateway serves the last cached value immediately while asynchronously refreshing it in the background, rather than forcing the requesting client to wait on a fresh upstream call.

### 6.2 Rate Limiting
- **Inbound**: per-client limits (e.g., by API key or IP) to prevent any single consumer from monopolizing gateway capacity.
- **Outbound**: a global limiter protecting the gateway's own quota with the upstream provider, shared correctly across all gateway instances via Redis (not per-instance in-memory counters, which would undercount true request volume).

### 6.3 Fault Tolerance
- Circuit breaker around every upstream call, with defined thresholds for failure rate and timeout.
- Defined fallback behavior when the breaker is open: serve last-known cached value if available; otherwise return a clear, typed error rather than hanging.
- Health check endpoint on each gateway instance for Nginx/orchestration to detect and route around unhealthy instances.

### 6.4 Observability
- Structured logging (JSON) for every request: endpoint, latency, cache status, rate-limit status, breaker state.
- Metrics exported for dashboarding (Prometheus format): request rate, error rate, cache hit ratio, breaker state transitions.
- Grafana dashboard visualizing the above in real time, to make load-test results demonstrable rather than just log-mined after the fact.

### 6.5 Deployment
- Full stack defined in Docker Compose: Nginx, N gateway instances, Redis, MongoDB, BullMQ worker.
- Configuration (TTLs, rate limits, breaker thresholds) externalized via environment variables, not hardcoded.

## 7. Testing & Validation Plan

- **Load testing** with k6, simulating:
  - Steady-state baseline traffic across all endpoints.
  - A burst scenario modeling a live match (concentrated load on score endpoints for a short window).
  - An upstream-failure scenario (upstream mocked or throttled) to validate circuit breaker behavior under load.
- **Before/after comparison**: run the burst scenario with caching disabled vs. enabled, and report the actual reduction in upstream calls and latency — these become the resume-ready numbers.
- **Scaling validation**: repeat the burst scenario with 1, 2, and 3 gateway instances behind Nginx, recording throughput at each step.

## 8. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Third-party API free tier has low request quota, limiting realistic load testing | Mock/replay upstream responses for load tests beyond quota; use real calls only for functional validation |
| Cache staleness during live matches could show outdated scores | Tune TTLs conservatively for live data; document the freshness/latency tradeoff explicitly rather than hiding it |
| Scope creep toward a full sports platform | Explicitly bounded by Non-Goals (Section 3.2) — the companion UI stays a thin demo client, not a product; no data ownership |

## 9. Resume/Portfolio Framing

Once built and validated, this project demonstrates: distributed caching strategy, distributed rate limiting, graceful degradation via circuit breaking, horizontal scaling of stateless services, and asynchronous processing — directly addressing backend/distributed-systems gaps relevant to SDE-focused roles, using real load-test data rather than theoretical claims.