# Contributing

## Getting set up

```bash
npm ci
docker compose up -d --build     # full stack on :8080
cd web && npm ci && npm run dev  # companion UI on :5173
```

The test suite needs a Redis on `localhost:6379`. `docker compose up -d redis` is enough
if you are not running the whole stack; override with `TEST_REDIS_URL` if yours lives
elsewhere.

## Before opening a pull request

```bash
npm run lint && npm run format:check && npm test    # backend
cd web && npm run lint && npm run typecheck && npm test   # frontend
```

CI runs exactly these, plus an OpenAPI contract check, a Docker build, and a smoke test
that brings the whole stack up and asserts a real cache MISS→HIT transition through Nginx.

## What "done" means here

This project's central claim is that its performance numbers are **measured, not
asserted**. That standard applies to changes too.

- **A change that affects caching, limiting, breaker behaviour or scaling needs a
  measurement, not an argument.** `./scripts/benchmark.sh`, `./scripts/scaling.sh` and
  `./scripts/failure.sh` exist for this. If a number in RESULTS.md moves, update it in
  the same PR and say which run produced it.
- **Never fill in a `_pending_` value by estimate.** An invented number is worse than a
  blank one, because a blank is honestly incomplete while a guess is quietly wrong.
- **New behaviour needs a test that fails without it.** The suite drives the real app
  against a real Redis rather than mocks, so a test that passes against a broken
  implementation is a test that has not been checked.
- **Document the trade-off, not just the feature.** Any decision where a competent
  engineer could reasonably have chosen otherwise belongs in an ADR
  (`docs/adr/`) — including what it costs. Several existing ADRs record decisions that
  were *reversed* after measurement contradicted the original reasoning; that history is
  the useful part.

## Code style

Prettier and ESLint are authoritative — `npm run format` and `npm run lint:fix`.

Comments should explain **why**, not what. The codebase leans on this heavily: the
non-obvious constraints (why Redis uses `volatile-lru` and not `allkeys-lru`, why the
rate limiter fails open, why Nginx needs a keepalive pool) are exactly the things a
future reader cannot reconstruct from the code alone.

Markdown documents are excluded from Prettier deliberately — they are hand-formatted
prose and tables, and reflowing them produces noisy diffs.

## Project layout

```
src/            gateway: routes, cache, rate limiting, breaker, analytics publisher
  routes/       HTTP surface (proxy, health, admin, docs)
  cache/        cache-aside store, freshness zones, stampede locks
  ratelimit/    token bucket + inbound/outbound middleware
  upstream/     provider client, breaker, endpoint definitions, transforms
  analytics/    queue publisher and the worker's Mongo writer
test/           backend tests (real app, real Redis, real mock provider)
web/            React companion UI (Vite + TypeScript + Tailwind)
mock-upstream/  stand-in provider with /__stats and /__control
k6/             load-test scenarios
scripts/        benchmark, scaling and failure runners
prometheus/     scrape config, recording rules, alerting rules
grafana/        provisioned datasource and dashboard
docs/adr/       architecture decision records
```
