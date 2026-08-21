# Changelog

Notable changes to SportsGateway. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

Hardening and tooling pass: making the project's engineering practice match the quality of
the system it already documented.

### Fixed — defects found by actually running things

- **Admin token guard applied to the entire application, not just `/admin/*`.** The admin
  router declared absolute paths and was mounted at the app root, so its pathless
  `router.use(requireAdminToken)` guarded every route. Latent because the guard
  short-circuits when no token is configured and `ADMIN_TOKEN` had never been set in any
  test — it would have activated the first time someone secured a deployment, returning
  401 for every client *as a result of enabling security*. Now mounted at `/admin`, with
  regression tests asserting public routes stay reachable while a token is set. See
  [ADR 0007](docs/adr/0007-admin-router-mounting.md).
- **Flaky test suite from a port-collision race.** `startMockUpstream` chose a random port
  in a fixed range with no collision check, while `node --test` runs test files in
  parallel processes. Two mocks drawing the same number made one fail to bind, surfacing
  as an unrelated-looking `SocketError: other side closed` in whichever suite lost. Now
  binds `PORT=0` and reads the OS-assigned port from the child's startup line, which makes
  the collision structurally impossible rather than merely unlikely.
- **`season` query parameter was unvalidated.** Unlike path parameters it never passed
  through `validate`, so arbitrary input reached the provider request and the cache key.
  Now pattern-checked, and resolved once so the request and the cache key cannot disagree.
- **`openapi.yaml` was missing from the Docker image.** `/docs` and `/openapi.json` are
  read from disk at startup, so they worked locally and 500'd in the container.

### Added

- **OpenAPI 3.0 contract** (`openapi.yaml`), served as interactive Swagger UI at `/docs`
  and raw at `/openapi.json`. Every operation carries an `operationId` for client
  codegen; CI fails the build if the spec stops validating.
- **CI pipeline** (`.github/workflows/ci.yml`) — five parallel jobs: backend lint/format/
  test/coverage against a real Redis service, frontend lint/typecheck/test/build, OpenAPI
  contract validation, a Docker build plus full-stack smoke test that asserts a real cache
  MISS→HIT transition and admin-route protection through Nginx, and a dependency audit.
- **Frontend test suite** — 20 Vitest + Testing Library tests covering the cache badge,
  API error contract, favourites persistence, and match rendering. Mutation-checked: each
  was confirmed to fail when the behaviour it covers is deliberately broken.
- **`test/adminAuth.test.js`** — 9 tests covering both halves of the admin auth contract.
- **Security middleware** — `helmet` and explicit configurable `cors`, plus a startup
  warning when running in production with no `ADMIN_TOKEN` set.
- **Seven architecture decision records** in `docs/adr/`, each stating what the decision
  costs, not only what it bought. Two record decisions reversed after measurement
  contradicted the original reasoning.
- **`CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `CHANGELOG.md`**, and a git repository —
  the project had none of these.
- **ESLint + Prettier** for backend and frontend, with the rule exceptions documented
  where they are non-obvious.
- **`HEALTHCHECK`** in the Dockerfile, so the image self-checks under plain `docker run`.
- **`npm run test:coverage`** — currently 93% line coverage on the backend.

### Changed

- `docker-compose.yml` now supplies a real default `ADMIN_TOKEN`, so the demo stack's
  cache-invalidation endpoints are protected out of the box instead of silently open.
- `scripts/benchmark.sh` sends the admin token on its configuration-verification call.
- Frontend `Home.tsx` no longer calls `setState` synchronously inside an effect, and only
  clears to a skeleton on the first load for a newly selected date rather than on every
  recurring poll.
- The live-ticker React context was split so the provider module exports only components,
  restoring Fast Refresh state preservation.

## Earlier work

The commits before this point built the system itself and measured it — proxy, caching
with stale-while-revalidate and stampede protection, bidirectional rate limiting, circuit
breaker, async analytics pipeline, horizontal scaling behind Nginx, Prometheus and Grafana
observability, and the k6 load-test campaign whose results are in
[RESULTS.md](RESULTS.md). Two defects found during that phase are recorded in
[ADR 0005](docs/adr/0005-nginx-upstream-keepalive.md) (Nginx ephemeral-port exhaustion at
a 44% error rate) and [ADR 0006](docs/adr/0006-mock-provider-for-load-testing.md) (mock
provider ID-sentinel collision that broke the browse-to-detail flow).
