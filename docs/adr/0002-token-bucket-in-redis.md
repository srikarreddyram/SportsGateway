# 2. Token bucket in Redis for both rate-limit directions

**Status:** Accepted

## Context

The gateway needs two independent limits pointing in opposite directions:

- **Inbound**, so one client cannot monopolise gateway capacity.
- **Outbound**, so the gateway as a whole never exceeds the provider's quota — the
  scarcer resource, and the one whose exhaustion breaks the product for everyone.

Because the gateway scales horizontally, an in-memory counter per instance would
undercount by exactly the replica factor: three instances each allowing 100 req/min
against a 100 req/min provider quota means 300 req/min actually sent. The limit has to be
shared state, not per-process state.

## Decision

A token bucket implemented as a Lua script in Redis, used for both directions with
different parameters. Redis is already a required dependency for the cache, so this adds a
shared, atomic counter without adding infrastructure.

Token bucket rather than fixed-window counting: it absorbs short bursts up to the bucket
capacity while still enforcing the average rate. Sports traffic arrives in bursts by
nature, and a fixed window would reject legitimate traffic at boundaries while allowing
double the intended rate across one.

The script is atomic. Read-modify-write from application code would race between replicas
under exactly the concurrent load the limiter exists to control.

## Consequences

**What it costs.** Every rate-limited request pays a Redis round-trip, and Redis becomes
a hard dependency of the request path. That second point drove a deliberate choice in
`inbound.js`: if the limiter errors, it **fails open** and allows the request. A limiter
outage degrading into a total outage would be a worse failure than briefly not enforcing
a limit.

**What it bought.** Verified against the live stack: 900 requests at 100 concurrent from
one client produced 845 × 200 and 55 × 429, with correct `X-RateLimit-Limit`,
`X-RateLimit-Remaining` and `Retry-After` headers. Because the bucket lives in Redis, that
budget is enforced across every replica rather than per-process.

**A subtlety worth recording.** Sequential requests can exceed the nominal capacity
without ever being rejected, because tokens refill during the requests. That is correct
token-bucket behaviour, not a bug — but it looks like a broken limiter to anyone testing
by hand with a slow loop, so it is called out in RESULTS.md §6 alongside the numbers.
