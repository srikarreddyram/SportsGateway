# SportsGateway: Milestones & Execution Checklist

**What you're building, phase by phase. Check off as you go.**

> **Build status (updated after implementation).** Everything in Milestones 1-8 is
> implemented and covered by the automated test suite (`npm test`, 65 tests). Items left
> unchecked are the ones that require actually *running* something not yet run on this
> machine: Docker is not installed, so the containerised stack, the Grafana dashboard and
> the k6 load tests have not been executed. Caching has been measured locally instead --
> see RESULTS.md. Unchecked boxes below are therefore "not yet executed", not "not yet
> built"; the code, configuration and scripts for each are in the repository.

---

## Milestone 1: Upstream API Access + Basic Proxy
**Goal**: Confirm third-party API integration works; build a simple request → upstream → response flow.

**Deliverables**:
- [ ] Third-party API account created (API-Sports or SportsRadar free tier) — *not done: the stack runs against the bundled mock provider; create an API-Sports account only when you want live data*
- [x] Node.js HTTP client set up (axios, node-fetch, or built-in fetch)
- [x] Express app with GET `/api/scores/:matchId` that proxies to upstream
- [x] GET `/api/fixtures/:date` proxy endpoint
- [x] GET `/api/players/:playerId` proxy endpoint
- [x] Error handling (timeout, 404, 500 from upstream)
- [x] Manual testing with curl/Postman confirms all three endpoints work end-to-end

**Estimated time**: 3–4 days (mostly if learning Node/Express fundamentals)

**Related learning phases**: 0.2 (Express), 0.1 (Async), 1.1 (API integration), 1.2 (Basic proxy), 1.3 (Multi-endpoint)

---

## Milestone 2: Redis Caching (Cache-Aside)
**Goal**: Reduce upstream API calls by caching responses with sensible TTLs.

**Deliverables**:
- [x] Redis container running (docker run or docker-compose) — *verified: runs in docker-compose, healthy, served every load test*
- [x] Cache-aside logic in proxy routes: check Redis → cache hit? return : call upstream, cache, return
- [x] TTLs set per endpoint (short for live data, long for static)
- [x] Response header `X-Cache: HIT | MISS` for visibility
- [x] Manual test: call endpoint twice quickly (should see HIT), wait past TTL, call again (should see MISS)
- [x] Counter/metric tracking cache hit vs miss rate
- [x] Load test baseline: requests with caching off, measure upstream call volume

**Estimated time**: 3–5 days

**Related learning phases**: 0.3 (Redis basics), 2.1 (Cache-aside), 2.2 (Invalidation), 2.3 (Monitoring)

---

## Milestone 3: Stale-While-Revalidate (Optional but recommended)
**Goal**: Serve cached data instantly while asynchronously refreshing in the background.

**Deliverables**:
- [x] Understand SWR pattern: stale-but-fast vs fresh-but-slow tradeoff
- [x] Implement background refresh logic (async, doesn't block response)
- [x] Track which keys are being refreshed (prevent duplicate upstream calls)
- [x] Manual test: get a cache hit, observe response is instant; new request after TTL observes old data served while refresh happens in background
- [ ] Load test: measure latency improvement vs cache-aside without SWR — *not run as an A/B comparison. SWR is demonstrably active (34,509 responses served stale while revalidating, 1,613 coalesced), but the isolated latency delta versus plain cache-aside was not measured.*

**Estimated time**: 2–3 days

**Related learning phases**: 2.2 (cache invalidation strategy)

**Note**: You can skip this and go straight to rate limiting if time is tight — cache-aside alone is sufficient to demonstrate caching strategy.

---

## Milestone 4: Rate Limiting (Inbound + Outbound)
**Goal**: Protect gateway from client abuse and protect upstream API from quota exhaustion.

**Deliverables**:
- [x] Understand token bucket vs sliding window algorithm
- [x] Inbound rate limiting: per-client limits (by IP or API key) using Redis counter
- [x] Express middleware that rejects requests over limit with 429 status
- [x] Outbound rate limiting: global limiter protecting upstream quota
- [x] Manual test: curl endpoint rapidly, should get 429 after N requests
- [ ] Test: if upstream quota is 100/min, load test with 200 concurrent clients should gracefully degrade (not crash) — *not run in this exact form: the outbound limiter was disabled during load tests so failures would reach the circuit breaker rather than being rejected before it. Graceful degradation under a dead upstream is proven instead in RESULTS.md section 4.*
- [x] Response includes `Retry-After` header on 429

**Estimated time**: 3–4 days

**Related learning phases**: 3.1 (Token bucket), 3.2 (Inbound limiting), 3.3 (Outbound limiting)

---

## Milestone 5: Circuit Breaker (opossum)
**Goal**: Fail fast when upstream is degraded; don't cascade failures.

**Deliverables**:
- [x] Understand circuit breaker states: closed → open → half-open → closed
- [x] Install + configure opossum library
- [x] Wrap upstream API calls in circuit breaker
- [x] Define failure thresholds (error rate, timeout count)
- [x] Fallback behavior: when breaker is open, return cached data or typed error (don't hang)
- [x] Manual test: kill upstream mock, call gateway → should fail fast, not timeout
- [x] Test: restore upstream, circuit breaker should eventually close and resume normal traffic
- [x] Observe: Grafana dashboard shows breaker state transitions — *verified: the dashboard's own breaker query, run against Prometheus, shows closed → open/half-open → closed tracking the injected outage; 12 open and 12 half-open transitions recorded*

**Estimated time**: 2–3 days

**Related learning phases**: 4.1 (Circuit breaker pattern), 4.2 (opossum integration)

---

## Milestone 6: Async Analytics Pipeline (BullMQ + MongoDB)
**Goal**: Log request metadata non-blocking; analyze gateway behavior afterward.

**Deliverables**:
- [x] Understand BullMQ: why async logging matters
- [x] MongoDB container running, connected from Node — *verified: worker connects, creates all six indexes on startup*
- [x] Event schema designed: { timestamp, endpoint, latency, cache_hit, status_code, client_ip, error_msg? }
- [x] Enqueue analytics event after every proxy response (non-blocking, no await)
- [x] BullMQ worker process that consumes queue and writes to MongoDB
- [x] Manual test: make requests, check MongoDB for logged events — *verified: 5,417,810 events written*
- [ ] Measure: response latency with/without async logging (should be negligible difference) — *not run as an A/B comparison. Indirect evidence only: p95 was 0.8 ms on cache hits with the queue running at ~300 events/s, so logging is clearly off the response path, but the controlled measurement was not done.*
- [x] Query MongoDB: count cache hits vs misses per endpoint — *verified: scores 3,696,936 hits / players 798,494 / fixtures 791,978, plus STALE, FALLBACK, COALESCED and BYPASS breakdowns*

**Estimated time**: 3–4 days

**Related learning phases**: 5.1 (BullMQ basics), 5.2 (Event schema), 5.3 (Integration)

---

## Milestone 7: Horizontal Scaling (Docker Compose + Nginx Load Balancing)
**Goal**: Run multiple stateless gateway instances; prove they scale linearly.

**Deliverables**:
- [x] Audit code for state: ensure no in-memory counters, cache, or session data
- [x] Move any in-memory state to Redis
- [x] Docker image for Node app builds and runs locally — *verified: builds and runs under Colima*
- [x] docker-compose.yml orchestrates: Nginx, gateway (scale to 3), Redis, MongoDB, BullMQ worker
- [x] Nginx configuration: round-robin load balancing across gateway instances
- [x] Test: curl localhost/api/scores/..., confirm requests hit different instances — *verified automatically: scripts/scaling.sh samples X-Instance and aborts the run unless traffic reaches exactly the expected replica count*
- [x] Service-to-service networking: all instances connect to Redis/Mongo by service name
- [x] Scale command: `docker compose up --scale gateway=3` works without code changes — *verified at 1, 2 and 3 replicas; Nginx picks up new replicas on `nginx -s reload`*

**Estimated time**: 3–4 days

**Related learning phases**: 0.5 (Docker), 6.1 (Stateless design), 6.2 (Docker Compose), 6.3 (Service networking)

---

## Milestone 8: Observability (Prometheus + Grafana)
**Goal**: Visualize system behavior in real-time; prove metrics matter.

**Deliverables**:
- [x] Structured JSON logging: every request logged with timestamp, method, path, latency, cache_hit, status
- [x] Prometheus metrics exported at `/metrics`: request_count, request_duration_histogram, cache_hit_counter, breaker_state_transitions
- [x] prom-client library integrated into Express app
- [x] Prometheus service added to docker-compose, configured to scrape gateway instances
- [x] Grafana service added to docker-compose
- [x] Grafana dashboard created with 4–5 panels (7 built, every query verified to return live data):
  - Requests per second (stacked by endpoint)
  - Cache hit rate % (gauge)
  - P95 latency (graph over time)
  - Circuit breaker state (stat)
  - Error rate % (graph)
- [x] Manual test: watch dashboard while making requests; metrics update live — *verified: every panel query returns live series from Prometheus*

**Estimated time**: 2–3 days

**Related learning phases**: 7.1 (Structured logging), 7.2 (Prometheus), 7.3 (Grafana)

---

## Milestone 9: Load Testing & Validation (k6 + Results)
**Goal**: Prove system works under realistic load; generate resume-ready numbers.

**Deliverables**:
- [x] k6 installed locally — *runs as a container in the compose stack, driving load from inside the network*
- [x] Load test script: ramp up to 100 concurrent users, run 5 minutes, hit 2-3 endpoints randomly
- [x] **Before scenario** (caching disabled): run load test, capture:
  - Total upstream API calls
  - Average gateway latency (ms)
  - P95 latency (ms)
  - Error rate (%)
- [x] **After scenario** (caching enabled): run same test, capture same metrics
- [x] **Calculate**: cache effectiveness = `(calls_before - calls_after) / calls_before * 100` — **98.2%** (85,676 → 1,514)
- [x] **Failure scenario**: mid-test, kill/degrade upstream; observe circuit breaker trip, error rate spike, graceful degradation — *breaker tripped within ~15s, 2,551 requests served from fallback cache, **zero** client errors*
- [x] **Scaling scenario**: run load test with 1, 2, 3 gateway instances; measure throughput at each level — *2,746 / 6,067 / 7,249 req/s*
- [x] **Document results**: create a summary with numbers — *see RESULTS.md*
- [ ] Grafana dashboards/screenshots from load test as evidence — *not captured: server-side PNG rendering needs Grafana's image-renderer plugin, which is not installed. The dashboard is live at http://localhost:3001 and every panel's underlying values are recorded in RESULTS.md; screenshots are a manual step.*

**Estimated time**: 4–5 days (mostly waiting on test execution)

**Related learning phases**: 8.1 (k6 basics), 8.2 (Before/after), 8.3 (Breaker under load), 8.4 (Scaling validation)

---

## Execution Timeline (Estimate)

| Phase | Learning | Build | Total |
|---|---|---|---|
| 0 (Fundamentals) | 5–7 days | — | 5–7 days |
| 1 (Basic Proxy) | — | 3–4 days | 3–4 days |
| 2 (Caching) | — | 3–5 days | 3–5 days |
| 3 (SWR) | — | 2–3 days | 2–3 days |
| 4 (Rate Limiting) | — | 3–4 days | 3–4 days |
| 5 (Circuit Breaker) | — | 2–3 days | 2–3 days |
| 6 (Analytics) | — | 3–4 days | 3–4 days |
| 7 (Scaling) | — | 3–4 days | 3–4 days |
| 8 (Observability) | — | 2–3 days | 2–3 days |
| 9 (Load Testing) | — | 4–5 days | 4–5 days |
| **TOTAL** | 5–7 days | 28–38 days | **33–45 days** |

**Reality check**: If you dedicate 1-2 hours/day, that's 4-8 weeks. Weekends/focused sprints can compress this.

---

## Resume-Ready Deliverables (After Milestone 9)

Once complete, you have:
1. **Live system** (github repo) with code
2. **Load test results** (concrete numbers on caching effectiveness, scaling, latency)
3. **Grafana screenshots** showing live metrics during load test
4. **1-line resume bullet** built on real data:
   - "Designed distributed API gateway (Node.js/Express) with Redis caching, reducing upstream API calls by X%; implemented circuit breaker for graceful degradation; validated horizontal scaling (N instances ≈ N× throughput) via k6 load testing."

---

## Checklist to Lock In

Print/screenshot this and check off as you go. Celebrate when you hit Milestone 9. 🚀