# SportsGateway: Learning Roadmap & Claude Code Prompt

**Learn by building, not by having it built for you.**

This document breaks down the SportsGateway project into concept-by-concept learning modules, with explicit instructions for Claude Code to act as a mentor, not an implementation machine.

---

## Philosophy

You will write the actual implementation code. Claude Code's job is to:
1. Explain concepts before you code
2. Provide minimal scaffolding/toy examples
3. Review your code, point out patterns/bugs, but not rewrite it wholesale
4. Answer syntax/API questions in real-time as you encounter them

**Not** to write the working system while you watch.

---

## Phase 0: Tech Stack Fundamentals (Before touching the project)

Before Milestone 1, build muscle memory in the core tech with isolated, small exercises.

### 0.1: Node.js & JavaScript Async Basics
**Goal**: Understand event loop, async/await, Promises, callbacks — the mental model that makes Node different from Python.

**Learning steps**:
1. Ask Claude Code: "Explain Node.js event loop. Show me a toy example of a blocking vs non-blocking operation."
2. Write your own: a simple file-read example using `fs.promises` with async/await.
3. Ask Claude Code to review your code — does it actually understand `.then()` chaining? Did you accidentally block?
4. Move to: "What happens when I make two async calls in parallel vs sequentially?" Write both versions.

**Deliverable**: You can explain why `await Promise.all([...])` is faster than `await a; await b;`.

### 0.2: Express Fundamentals
**Goal**: Understand routing, middleware, request/response objects, error handling.

**Learning steps**:
1. Ask Claude Code: "Scaffold a minimal Express app with 3 routes (GET /health, POST /data, GET /data/:id). Just the skeleton, I'll fill in the logic."
2. Write the actual route handlers — you decide what each returns.
3. Add middleware: a custom logger that logs every request method + path. Claude Code should explain middleware order and chaining, you write it.
4. Add error handling: wrap a route handler in try/catch, use Express's error-handling middleware. Ask Claude Code for the signature, you implement.

**Deliverable**: You can add a new route, add middleware that inspects/modifies the request, and handle errors without asking.

### 0.3: Redis Basics
**Goal**: Understand key-value operations, TTL, data types (strings, hashes, sets), and the async client.

**Learning steps**:
1. Start a Redis container locally (`docker run -d -p 6379:6379 redis`).
2. Ask Claude Code: "Show me the Node.js redis client API. Explain get/set/del/expire."
3. Write a small Node script (not Express yet) that: sets a key with a TTL, retrieves it, waits past expiry, tries to get it again (should be null).
4. Explore data types: write a counter script (incr), a hash (hset/hget for a user object), a set (sadd/smembers).
5. Ask Claude Code: "Why use Redis instead of just in-memory objects?" (Persistence, multi-process visibility, atomic operations.)

**Deliverable**: You can use the redis client to set a key with TTL, increment counters, and explain why it matters that these operations are atomic.

### 0.4: MongoDB Basics
**Goal**: Understand collections, documents, queries, and the Node.js driver.

**Learning steps**:
1. Start a MongoDB container locally (`docker run -d -p 27017:27017 mongo`).
2. Ask Claude Code: "Show me MongoDB schema design for an event log (timestamp, endpoint, latency, cache_hit: true/false). What should be indexed?"
3. Write a Node script that: connects to Mongo, inserts a document, queries by endpoint name, updates a document, deletes one.
4. Write a query that counts cache hits vs misses per endpoint.
5. Ask Claude Code: "Why not just use Redis for everything instead of adding Mongo?" (Persistence at scale, complex queries, separation of hot/cold data.)

**Deliverable**: You can design a document schema, write an insert/query, and explain indexing trade-offs.

### 0.5: Docker & Docker Compose
**Goal**: Understand containerization, multi-container orchestration, networking, and volume mounting.

**Learning steps**:
1. Ask Claude Code: "Explain Dockerfile basics. Show me a minimal Dockerfile for a Node app."
2. Write your own Dockerfile for a simple Express app (you have one from 0.2). Build it, run it locally.
3. Ask Claude Code: "How does docker-compose.yml let multiple containers talk to each other?"
4. Write a docker-compose.yml that runs: your Node app (from 0.2), a Redis container, and a MongoDB container. All should be able to connect to each other by service name.
5. Verify: from your Node container, can you reach Redis and MongoDB without hardcoding IPs?

**Deliverable**: You can write a Dockerfile, understand service networking in compose, and know when to use volumes vs bind-mounts.

---

## Phase 1: Build the Basic Proxy (Milestone 1)

Now you have the fundamentals. Time to build the actual first piece.

### 1.1: Third-Party API Integration
**Goal**: Understand HTTP client libraries, API authentication, response parsing.

**Learning steps**:
1. Choose your upstream API: API-Sports (https://www.api-football.com/) or SportsRadar. Get a free-tier key.
2. Ask Claude Code: "Which Node HTTP client should I use — node-fetch, axios, or built-in fetch()?" Understand the tradeoffs.
3. Write a small script that: makes a request to the upstream API (e.g., fetch live scores), logs the response structure.
4. Parse the response: extract the fields you actually care about (match ID, teams, score). Ask Claude Code: "How should I shape this data for my gateway?"

**Deliverable**: You can make an authenticated request to the upstream API and extract relevant fields from the JSON response.

### 1.2: Express Proxy Endpoint
**Goal**: Build the first `GET /api/scores/:matchId` endpoint that proxies upstream, but first just returns the raw upstream response.

**Learning steps**:
1. Ask Claude Code: "What does a basic proxy look like?" (Get request param, call upstream, return response). Explain error handling.
2. Create a new Express route: `GET /api/scores/:matchId`.
3. Inside the handler, call the upstream API using the HTTP client from 1.1. Return the response as JSON.
4. Test it: call your endpoint from Postman or curl. Does it match what the upstream API returns?
5. Add error handling: what if the upstream times out? What if the matchId doesn't exist? Write try/catch, return sensible error responses.

**Deliverable**: You can call an upstream API from an Express route handler and return the response to a client, with proper error handling.

### 1.3: Multi-Endpoint Proxy
**Goal**: Build 2-3 proxy routes (fixtures, player stats, live scores) so you have multiple data shapes to cache later.

**Learning steps**:
1. Design the routes: what upstream endpoints do you actually want to expose? (e.g., `/api/fixtures/:date`, `/api/scores/:matchId`, `/api/players/:playerId`).
2. Ask Claude Code: "Should I write each route separately or use a route factory/middleware to reduce duplication?"
3. Implement the routes. If you write a factory, Claude Code should explain the pattern, you implement it.
4. Test all three endpoints end-to-end.

**Deliverable**: Multiple proxy routes working, minimal duplication in your route code.

### 1.4: Request/Response Shaping (Optional but recommended)
**Goal**: Transform upstream responses into a consistent shape (e.g., flatten nested objects, rename fields for clarity).

**Learning steps**:
1. Look at the raw upstream JSON for one endpoint. Ask Claude Code: "Should the gateway return this raw, or shape it into something cleaner for consumers?"
2. Write a transformation function that takes the upstream response and returns a simplified shape.
3. Apply it in your proxy route handler.
4. Test: does your shaped response still contain the data clients actually need?

**Deliverable**: Your gateway returns predictable, intentional JSON shapes, not just raw upstream passthrough.

---

## Phase 2: Add Redis Caching (Milestone 2)

Now cache the proxy responses to reduce upstream load.

### 2.1: Cache-Aside Pattern
**Goal**: Understand the cache-aside flow and implement it by hand.

**Learning steps**:
1. Ask Claude Code: "Explain cache-aside (check-cache, miss-update-cache, hit-return). Show a pseudocode example."
2. In your proxy route handler, before calling upstream:
   - Check Redis for the key (e.g., `match:${matchId}:score`).
   - If hit, return it. If miss, call upstream, store in Redis (with a TTL), then return.
3. Ask Claude Code: "How long should the TTL be?" (Depends on data volatility — live matches: 5-10s, finished matches: hours.)
4. Test manually: call your endpoint twice quickly (should hit cache). Wait past the TTL, call again (should hit upstream).

**Deliverable**: Your proxy routes cache responses in Redis with sensible TTLs, and you can verify the behavior by hand.

### 2.2: Cache Invalidation Strategy
**Goal**: Understand the tradeoffs in invalidation (TTL vs explicit, partial vs full).

**Learning steps**:
1. Ask Claude Code: "What are the invalidation strategies?" (TTL-based, explicit/manual, event-driven.)
2. For your project, you're using TTL-based (simplest). But talk through: what if an upstream API updates a score between your TTL checks? Document the freshness/latency tradeoff.
3. Optional: implement a manual invalidation endpoint (e.g., `DELETE /cache/match/:matchId`) for testing.

**Deliverable**: You understand why TTL-based caching is fine for this project and can explain the tradeoff.

### 2.3: Monitoring Cache Performance
**Goal**: Know whether caching is actually working.

**Learning steps**:
1. Add a response header to your proxy handler: `X-Cache: HIT` or `X-Cache: MISS`. This is your instrumentation.
2. Ask Claude Code: "How should I count cache hits vs misses?" (You could log it, or track metrics separately.)
3. Write a simple counter: every time you hit cache, increment a Redis counter. Every miss, increment a different counter.
4. Load test your gateway (using curl in a loop or k6 later) and check the counters: are you actually getting cache hits?

**Deliverable**: You can measure cache hit rate and see the impact of caching on upstream API calls.

---

## Phase 3: Add Rate Limiting (Milestone 4, skip stale-while-revalidate for now)

Two directions: inbound (client limits) and outbound (upstream protection).

### 3.1: Token Bucket Algorithm
**Goal**: Understand the mental model before implementing.

**Learning steps**:
1. Ask Claude Code: "Explain token bucket rate limiting. How is it different from sliding window?"
2. Draw/write it out: a bucket fills at a fixed rate, requests consume tokens. When empty, reject.
3. Ask Claude Code: "Why is token bucket good for bursty traffic?" (Allows small bursts above the average rate, unlike strict rate limits.)

**Deliverable**: You can explain token bucket vs sliding window without looking it up.

### 3.2: Inbound Rate Limiting (per-client)
**Goal**: Limit how fast a single client can call your gateway.

**Learning steps**:
1. Ask Claude Code: "How do I identify a client in Express?" (API key header, IP address, etc.) For this project, use IP (req.ip).
2. Implement a simple rate limiter: use Redis to track `rate_limit:${clientIP}` as a counter with a fixed window (e.g., reset every 60 seconds).
3. Add Express middleware that checks this counter before calling the upstream proxy. If exceeded, return 429 (Too Many Requests).
4. Test manually: curl your endpoint rapidly from your local machine (it's your IP), should get 429 after N requests.

**Deliverable**: You can add rate-limit middleware that blocks requests over a threshold.

### 3.3: Outbound Rate Limiting (protecting upstream)
**Goal**: Ensure your gateway never hammers the upstream API beyond its quota.

**Learning steps**:
1. Check your upstream API's rate limit (e.g., "100 requests per minute").
2. Implement a global limiter: use Redis `rate_limit:upstream` counter. Every time the gateway makes an upstream call, check/decrement this counter. If it would go negative, reject the client request with 429 and a `Retry-After` header.
3. Ask Claude Code: "Should inbound limits be stricter than outbound limits?" (Yes — you want to protect upstream first, then manage client expectations.)
4. Test: if your upstream quota is 100/min and you hammer with 200 concurrent clients, your gateway should gracefully reject some of their requests, not crash.

**Deliverable**: Your gateway protects itself from exceeding the upstream API quota.

---

## Phase 4: Add Circuit Breaker (Milestone 5)

Graceful degradation when upstream is down.

### 4.1: Circuit Breaker Pattern
**Goal**: Understand the three states (closed, open, half-open) and when to transition.

**Learning steps**:
1. Ask Claude Code: "Explain circuit breaker. Why not just retry forever?"
2. Mental model: closed = normal operation, open = fail fast (don't call upstream), half-open = test if upstream recovered.
3. Ask Claude Code: "What metrics trigger state transitions?" (Error rate threshold, timeout count, success rate recovery.)

**Deliverable**: You can draw/explain the state diagram without looking it up.

### 4.2: Integrate `opossum` Library
**Goal**: Use the opossum circuit breaker library for Node.

**Learning steps**:
1. Ask Claude Code: "How does opossum work? Show me a minimal example."
2. Install opossum: `npm install opossum`.
3. Wrap your upstream API call in an opossum circuit breaker:
```javascript
const breaker = new CircuitBreaker(async (matchId) => {
  // return fetch from upstream
}, { threshold: 0.5, timeout: 5000 });

// In your route handler:
try {
  const data = await breaker.fire(matchId);
} catch (err) {
  // breaker is open — fail fast
}
```
4. Test: make requests when upstream is healthy (should succeed). Simulate upstream failure (kill the container or mock a 500 response), make requests (should fail fast without waiting, should eventually use cached data).

**Deliverable**: Upstream failures don't cascade; your gateway fails fast and falls back to cache.

---

## Phase 5: Async Analytics Pipeline (Milestone 6)

Non-blocking logging and analytics.

### 5.1: BullMQ Basics
**Goal**: Understand job queues and why async logging matters.

**Learning steps**:
1. Ask Claude Code: "What's BullMQ? Why queue analytics instead of writing synchronously?"
2. Understand the tradeoff: synchronous writes slow down responses; async via queue keeps responses fast, processes logs in background.
3. Ask Claude Code: "Show me a minimal BullMQ example: enqueue a job, consume it."
4. Write a tiny test: enqueue a job from one script, consume/log it from another.

**Deliverable**: You understand why BullMQ is useful and can enqueue/consume a basic job.

### 5.2: Analytics Event Schema
**Goal**: Design what data to log.

**Learning steps**:
1. Decide: what should every request log? (timestamp, endpoint, latency, cache_hit, client_ip, status_code, error_message if applicable).
2. Create a schema object / interface for your analytics event.
3. Ask Claude Code: "Should I log every request or sample?" (For portfolio, log all; in production, you'd sample.)

**Deliverable**: You have a clear schema and know what to log.

### 5.3: Integrate BullMQ into Your Routes
**Goal**: Enqueue analytics events from your proxy handlers without blocking the response.

**Learning steps**:
1. In your proxy route handler, after sending the response to the client, enqueue an analytics event to the BullMQ queue (don't await it, let it fire in the background).
2. Write a separate worker process that consumes the queue and writes events to MongoDB.
3. Test: make requests, check MongoDB for logged events. Measure: does adding async logging change your response latency? (Should be negligible.)

**Deliverable**: Analytics are logged asynchronously; responses stay fast.

---

## Phase 6: Horizontal Scaling & Docker Compose (Milestone 7)

Run multiple gateway instances, prove they scale.

### 6.1: Stateless Design
**Goal**: Ensure your gateway has no in-memory state.

**Learning steps**:
1. Audit your code: is there anything in memory that would differ across two instances? (Counters, cache, session data?)
2. If yes, move it to Redis. Example: if you counted requests per second in memory, move that counter to Redis.
3. Ask Claude Code: "Why does stateless matter for horizontal scaling?" (New instances can start anytime, old ones can stop, load balancer can route flexibly.)

**Deliverable**: Your gateway is stateless — two instances behave identically.

### 6.2: Docker Compose Full Stack
**Goal**: Orchestrate the full system: Nginx, Node instances, Redis, MongoDB, BullMQ worker.

**Learning steps**:
1. Write a docker-compose.yml that defines:
   - `nginx` service (load balancer)
   - `gateway1`, `gateway2` services (Node.js)
   - `redis` service
   - `mongodb` service
   - `worker` service (BullMQ consumer)
2. Ask Claude Code: "How do I scale to 3 instances?" (Update compose to `gateway1`, `gateway2`, `gateway3`.)
3. Test: `docker compose up`, wait for all services to start, curl `localhost/api/scores/...` — does it hit different instances? (You can add a hostname header response to verify.)

**Deliverable**: Full stack runs in Docker Compose; you can add/remove instances by editing compose.

### 6.3: Service-to-Service Communication
**Goal**: Understand how instances talk to each other (Redis, Mongo) by service name.

**Learning steps**:
1. In your Node code, connect to Redis using the service name: `redis://redis:6379` (not `localhost`).
2. Same for MongoDB: `mongodb://mongodb:27017`.
3. Ask Claude Code: "Why does DNS resolution by service name work in Docker Compose?" (Docker's built-in DNS server.)
4. Test: spin up compose, make sure all instances can reach Redis and Mongo.

**Deliverable**: All instances share the same Redis/Mongo by service name; no hardcoded IPs.

---

## Phase 7: Observability (Milestone 8)

Prometheus metrics + Grafana dashboard.

### 7.1: Structured Logging
**Goal**: Log in JSON so it's queryable later.

**Learning steps**:
1. Ask Claude Code: "What's structured logging? Why not just console.log()?"
2. Use a logger library (e.g., `winston` or `pino`). Ask Claude Code which is simpler.
3. Update your routes to log every request as JSON: `{ timestamp, method, path, status, latency_ms, cache_hit, ip }`.
4. Redirect logs to both console (for local development) and a file (for later analysis).

**Deliverable**: Every request is logged as parseable JSON.

### 7.2: Prometheus Metrics
**Goal**: Export request rate, latency, error rate, cache hit rate in Prometheus format.

**Learning steps**:
1. Ask Claude Code: "How does Prometheus scraping work?" (Your app exposes a `/metrics` endpoint, Prometheus polls it, extracts time-series data.)
2. Use `prom-client` library. Ask Claude Code for a minimal example.
3. In your routes, track:
   - Request count (per endpoint)
   - Request duration (histogram for latency)
   - Cache hit/miss counter
   - Circuit breaker state transitions
4. Expose these at `GET /metrics` in Prometheus text format.
5. Test: curl `localhost:3000/metrics`, should see your metrics.

**Deliverable**: Your gateway exports Prometheus metrics.

### 7.3: Grafana Dashboard
**Goal**: Visualize the metrics during load testing.

**Learning steps**:
1. Add Prometheus and Grafana to docker-compose.yml.
2. Configure Prometheus to scrape your gateway instances.
3. In Grafana, create a simple dashboard:
   - Requests per second (graph)
   - Cache hit rate % (gauge)
   - P95 latency (graph)
   - Circuit breaker state (stat)
4. Test: start the stack, make requests, watch the dashboard update in real-time.

**Deliverable**: You have a live dashboard showing system behavior.

---

## Phase 8: Load Testing & Validation (Milestone 9)

Prove the system works under load.

### 8.1: k6 Load Testing Script
**Goal**: Write a realistic load test that simulates the use case.

**Learning steps**:
1. Ask Claude Code: "What's k6? Why not just use Apache Bench or wrk?" (k6 is cloud-native, JavaScript-based, good for complex scenarios.)
2. Install k6.
3. Write a k6 script that:
   - Ramps up to 100 concurrent users over 1 minute
   - Each user randomly hits 2-3 endpoints (scores, fixtures, players)
   - Runs for 5 minutes
   - Ramps down
4. Run it against your local gateway, watch Grafana dashboard during the test.

**Deliverable**: You can write and execute a load test.

### 8.2: Before/After Comparison
**Goal**: Measure the real impact of caching.

**Learning steps**:
1. Run the k6 load test with caching **disabled** (comment out the Redis cache logic). Capture:
   - Total requests to upstream API
   - Average gateway latency
   - P95 latency
2. Run the same test with caching **enabled**. Capture the same metrics.
3. Calculate: `(upstream_calls_no_cache - upstream_calls_with_cache) / upstream_calls_no_cache * 100` = cache effectiveness percentage.
4. Document these numbers — they become your resume bullet points.

**Deliverable**: Real, measured improvements from caching. Example: "Caching reduced upstream API calls by 78% under realistic load."

### 8.3: Circuit Breaker Under Load
**Goal**: Prove graceful degradation.

**Learning steps**:
1. Run your load test. Halfway through, kill the upstream API (docker compose stop <upstream-mock> or just don't mock it and let it fail).
2. Observe: do requests cascade into timeout hell, or does the circuit breaker trip and return fast?
3. Watch the Grafana dashboard: do you see a spike in error rate, then a recovery as cached data starts serving?

**Deliverable**: Circuit breaker behavior under failure is observable and predictable.

### 8.4: Horizontal Scaling Validation
**Goal**: Prove adding instances improves throughput.

**Learning steps**:
1. Run k6 load test with 1 gateway instance. Measure: requests/second, average latency.
2. Scale to 2 instances (docker compose up --scale gateway=2). Run the same test. Measure again.
3. Scale to 3 instances, repeat.
4. Plot: throughput should scale roughly linearly (2x instances ≈ 2x throughput).

**Deliverable**: Real scaling numbers. Example: "Adding a second instance increased throughput from 1,200 to 2,350 req/s (1.96x)."

---

## Claude Code Prompt Template

**Use this exact prompt when starting work in Claude Code:**

```
You are a mentor helping me learn backend systems and distributed systems engineering by building a real project (SportsGateway — an API gateway with caching, rate limiting, circuit breakers, and async logging).

I want to LEARN, not just see working code. This means:

1. EXPLAIN BEFORE CODE: Before writing any code, explain the concept (cache-aside pattern, token bucket algorithm, circuit breaker states, etc.) in plain language. Show a tiny toy example if helpful.

2. I WRITE THE IMPLEMENTATION: After you explain, I write the actual code (you don't write the full working version). Ask clarifying questions about what I'm trying to do. Point out bugs or bad patterns in my code, but don't rewrite it wholesale.

3. SCAFFOLD MINIMALLY: If I ask you to scaffold a project structure or a route handler skeleton, do that. But leave the logic for me to fill in.

4. ANSWER SYNTAX QUESTIONS: When I ask "how do I do X in Express?" or "what's the Redis client API for Y?", give me the specific answer without writing the full implementation.

5. REVIEW & EXPLAIN: After I write something, review it. Explain what's good, what could be better, and why. Don't just say "looks good" or rewrite it.

6. STAY IN SCOPE: We're learning a specific tech stack (Node.js, Express, Redis, MongoDB, Docker, k6, opossum, BullMQ). Keep the project focused on the PRD.

I'm starting with Phase 0 (Tech Stack Fundamentals). Guide me through each learning step, asking me to write code and reviewing what I produce. We'll move to Phase 1 (Basic Proxy) once I've done Phase 0.

The full learning roadmap is in SportsGateway_LEARNING_ROADMAP.md. Reference it.

Let's start with **Phase 0.1: Node.js & JavaScript Async Basics**. Explain the event loop, async/await, and Promises. Give me a toy example, then I'll write my own.
```

---

## Summary

- **Phases 0–8**: Concept-by-concept learning, not milestone spray.
- **You write code**; Claude Code reviews and explains.
- **Load test results become resume numbers** (Phase 8).
- **Use the prompt above** every time you open Claude Code to keep it in teaching mode.

Start with Phase 0.1 whenever you're ready.