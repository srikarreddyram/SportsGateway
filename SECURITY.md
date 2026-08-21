# Security

## Reporting a vulnerability

Open a GitHub security advisory on the repository rather than a public issue. Please
include reproduction steps and the affected version or commit.

## Security posture

This is a portfolio demonstration of distributed-systems engineering, not a hardened
production deployment. The controls below are real and tested; the gaps after them are
stated plainly rather than left for a reader to discover.

### What is in place

- **Security headers** via `helmet` — HSTS, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options`, and the rest of the default set. `X-Powered-By` is disabled.
- **CORS** is explicit and configurable (`CORS_ORIGIN`), defaulting to `*` because every
  data route is public, read-only, and carries no cookie or bearer credential — the same
  reasoning a public read API or CDN relies on. Set an allowlist to restrict it.
- **Admin endpoints are authenticated** by a shared secret (`ADMIN_TOKEN`) covering both
  live-state inspection and cache invalidation. `docker-compose.yml` supplies a real
  default rather than leaving it blank, so the demo stack is not open by accident.
  Regression tests assert both that admin routes reject unauthenticated requests **and**
  that public routes stay reachable when a token is configured — see
  [ADR 0007](docs/adr/0007-admin-router-mounting.md) for the defect that motivated the
  second half.
- **Input validation at the boundary.** Every path parameter is pattern-checked before it
  reaches the provider or becomes a cache key. The `season` query parameter was an
  unvalidated gap and is now checked too.
- **Rate limiting in both directions**, shared across replicas through Redis, so a single
  client cannot monopolise the gateway and the gateway cannot exhaust the provider's quota.
- **No secrets in the image or the repository.** Credentials arrive by environment
  variable; `.env` is gitignored and `.env.example` carries no real values.
- **Unprivileged container.** The runtime image runs as the `node` user, not root.
- **Dependency auditing in CI**, failing on high or critical advisories.
- **Typed errors.** Failures return a deliberate status and machine-readable code; an
  upstream failure never leaks a stack trace or provider detail to a client.

### Known gaps — deliberate, given the scope

- **No client authentication on data routes.** The API is intentionally public. Inbound
  rate limiting identifies clients by API key header when present and IP otherwise, but
  that is quota accounting, not authentication.
- **`ADMIN_TOKEN` is a shared static secret.** No rotation, no per-user identity, no
  audit trail beyond the request log. Adequate for guarding a demo's cache-invalidation
  endpoint; not an authorization system.
- **The compose default admin token is public** by virtue of being in this repository.
  It exists so the demo stack is not unauthenticated out of the box — it is not a secret,
  and anything beyond a local demo must set its own.
- **No TLS in the stack.** Nginx serves plain HTTP; termination is assumed to happen at a
  load balancer in front of it. The HSTS header helmet sets is therefore aspirational in
  this configuration.
- **Grafana allows anonymous viewer access** so the dashboards are inspectable without
  credentials, and Prometheus has no authentication at all. Both would need locking down
  before exposure beyond localhost.
- **The rate limiter fails open.** If Redis is unreachable the limiter allows the request
  rather than rejecting it — a deliberate availability-over-enforcement trade documented
  in [ADR 0002](docs/adr/0002-token-bucket-in-redis.md), but it does mean a Redis outage
  removes rate limiting.
