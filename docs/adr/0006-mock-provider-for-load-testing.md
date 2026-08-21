# 6. A bundled mock provider as the load-test upstream

**Status:** Accepted

## Context

The gateway exists to sit in front of a third-party sports API. Validating it requires
driving hundreds of thousands of requests through it and, separately, making the provider
fail on demand to exercise the circuit breaker.

Neither is possible against the real provider. Free tiers cap out around 100 requests/day
— roughly four orders of magnitude short of one burst run — and no provider offers a
"start returning 503 now, stop in sixty seconds" control.

## Decision

Ship a mock provider that mimics API-Sports' response shapes, and point the stack at it by
default. It adds three capabilities the real provider structurally cannot:

1. **`GET /__stats`** — an exact count of calls that actually reached the provider. This
   is the number every caching claim rests on, and it is measured _at the provider_, so
   the headline "98.2% fewer upstream calls" cannot be flattered by gateway-side
   accounting.
2. **`POST /__control`** — injects latency, error rates, and hard failures on demand, so
   breaker behaviour is demonstrable mid-test instead of requiring a real outage.
3. **Deterministic responses** — a given ID always produces the same match, so runs are
   comparable across days.

The real provider stays fully supported: set `UPSTREAM_BASE_URL` and `UPSTREAM_API_KEY`
and the same code path serves live data.

## Consequences

**What it costs, stated plainly.** The load-test numbers characterise the gateway against
a _simulated_ provider, not a real one. The mock's ~80 ms latency is a modelled figure;
real provider latency varies with their load, geography and time of day. Response shapes
match API-Sports' documented schema but have never been reconciled against a live
response, so a schema drift would not be caught here. The gateway has never made a request
to the actual API-Sports service — that remains genuinely unverified and is listed as an
open gap in the milestone checklist rather than quietly omitted.

**What it bought.** Every claim in RESULTS.md is reproducible on any machine with Docker,
in about 25 minutes, with no account, no key, and no quota. The failure scenario is
repeatable on demand rather than opportunistic. And the upstream call counter — the single
most load-bearing measurement in the project — comes from an independent process rather
than from the component being evaluated.

**A bug this decision caused.** The mock's "unknown ID" sentinel (originally IDs ≥ 900,000)
collided with the ID scheme its own `/fixtures?date=` endpoint generated (date-shaped
numbers like `20260820`). Every match surfaced by a date listing returned 404 when fetched
by ID — the entire browse-to-detail flow was broken, and only surfaced when a UI actually
clicked through it. The sentinel is now 900,000,000. Worth recording because it is the
characteristic risk of a hand-written test double: its internal conventions can quietly
contradict each other in ways a real provider's wouldn't.
