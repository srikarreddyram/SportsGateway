# 5. Nginx upstream block with keepalive, requiring reload on scale

**Status:** Accepted — reversed an earlier decision after measurement

## Context

Nginx load-balances across gateway replicas. Because replicas are added and removed with
`docker compose --scale`, the config has to cope with a changing set of backends.

The original approach used a **variable** in `proxy_pass` with Docker's embedded DNS
resolver. That re-resolves per request, so new replicas are picked up with no reload and
no config change — which is exactly what you want for a scaling demo.

## Decision

Replaced with a static `upstream` block plus a `keepalive` pool. Scale changes now require
`nginx -s reload` (graceful, no dropped connections), which `scripts/scaling.sh` performs
automatically.

**This reverses the earlier choice, and measurement is why.** OSS Nginx only maintains a
keepalive connection pool for an `upstream` block; a variable `proxy_pass` has no pool, so
Nginx opens a **new TCP connection for every proxied request**. Under the saturation load
test that exhausted the container's ephemeral ports:

```
connect() to 172.18.0.5:3000 failed (99: Address not available) while connecting to upstream
```

The result was a **44% error rate** — while the gateway itself was completely healthy,
logging zero errors and only 200s. The load balancer was the bottleneck, and the failure
looked like a gateway failure.

## Consequences

**What it costs.** A scale change needs a reload to take effect. That is a real
operational step the previous design did not have, and forgetting it means new replicas
sit idle receiving nothing. `scripts/scaling.sh` does the reload and then _verifies_
traffic is reaching the expected number of distinct instances before measuring, because a
scaling benchmark that silently tests the wrong replica count produces plausible,
meaningless numbers — which had already happened once.

**What it bought.** Errors went from 44% to **zero** at the same load, and the scaling
test became measurable at all: 2,746 → 6,067 → 7,249 req/s across 1, 2 and 3 replicas.

**The general lesson**, worth more than the specific fix: connection reuse is not a
micro-optimisation at the proxy layer. Per-request connection setup is a hard scaling
ceiling that appears suddenly, as resource exhaustion rather than gradual slowdown, and it
implicates the wrong component when it does.
