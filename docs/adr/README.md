# Architecture Decision Records

Short records of decisions that were not obvious, where a reasonable engineer could have
chosen differently. Each one states the context, the decision, and what it costs — the
cost section matters most, because a decision recorded without its downside reads like
marketing rather than engineering.

Several of these were settled by measurement rather than argument, and those cite the run
in [RESULTS.md](../../RESULTS.md).

| #                                                       | Decision                                                        | Status   |
| ------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| [0001](0001-cache-aside-with-stale-while-revalidate.md) | Cache-aside with stale-while-revalidate and single-flight locks | Accepted |
| [0002](0002-token-bucket-in-redis.md)                   | Token bucket in Redis for both rate-limit directions            | Accepted |
| [0003](0003-circuit-breaker-per-instance.md)            | Per-instance circuit breaker, not shared state                  | Accepted |
| [0004](0004-async-analytics-via-queue.md)               | Analytics through a queue rather than on the response path      | Accepted |
| [0005](0005-nginx-upstream-keepalive.md)                | Nginx upstream block with keepalive, requiring reload on scale  | Accepted |
| [0006](0006-mock-provider-for-load-testing.md)          | A bundled mock provider as the load-test upstream               | Accepted |
| [0007](0007-admin-router-mounting.md)                   | Admin routes mounted under a path prefix                        | Accepted |
