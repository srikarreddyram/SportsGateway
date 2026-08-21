# 1. Cache-aside with stale-while-revalidate and single-flight locks

**Status:** Accepted

## Context

Sports traffic is bursty and concentrated: during a live match a handful of match IDs
take most of the load, and every client wants the same rapidly-changing value. Three
distinct problems fall out of that shape.

1. **Volatility varies enormously by record.** A finished match is immutable; an in-play
   score is stale within seconds. One TTL cannot serve both without either hammering the
   provider for data that will never change, or serving minutes-old scores.
2. **A TTL expiry under concurrent load is a stampede.** The moment a hot key expires,
   every in-flight request for it misses simultaneously and they all call upstream —
   precisely when traffic is heaviest.
3. **Expiry makes a client wait.** Strict cache-aside means whoever arrives first after
   expiry pays the full upstream latency, even though a value one second past its TTL is
   almost always good enough for a live score.

## Decision

Cache-aside as the base pattern, with three refinements:

- **Volatility-tuned TTLs** chosen per record, not per route: `ttlFor()` inspects the
  payload, so a finished match caches for hours and a live one for seconds _on the same
  endpoint_.
- **Stale-while-revalidate**: an entry past its freshness window but inside its stale
  window is served immediately and refreshed in the background. The Redis key's own TTL
  is deliberately longer than the freshness window, which is what leaves a last-known-good
  value available for fallback.
- **Single-flight locks**: on a true miss, one request acquires a Redis lock and calls
  upstream; the others wait briefly for it to fill the cache rather than each making
  their own call.

## Consequences

**What it costs.** Clients can receive data one refresh-interval stale, and the API says
so rather than hiding it — `X-Cache: STALE` and `meta.ageMs` are on every response so a
consumer can decide for itself. The lock adds a Redis round-trip to the miss path and
introduces a failure mode that had to be handled explicitly: a holder that dies mid-flight
would block a key, so locks carry their own expiry and waiters fall through to upstream
rather than failing.

**What it bought.** Measured under the burst scenario: 98.2% fewer upstream calls
(85,676 → 1,514) at a 99.83% hit rate, with p95 dropping 119.8 ms → 0.8 ms. Under real
concurrency the coalescing path fired 1,613 times — those are upstream calls that a plain
cache-aside implementation would have made.

**When this would be wrong.** With a flat key distribution — every request for a
different record — the hit rate collapses and the lock overhead buys nothing. This design
is aimed squarely at the concentrated-hot-key shape that live sports traffic actually has.
