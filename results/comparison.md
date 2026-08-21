# Load test results: caching before/after

Generated 2026-08-19T10:47:39.275Z from `results/`.

Both runs execute the identical live-match burst scenario against the identical stack.
The only difference is `CACHE_ENABLED`. Upstream call counts are read from the provider,
not from the gateway, so they cannot be flattered by gateway-side accounting.

| Metric | No cache | With cache |
|---|---|---|
| Client requests served | 85,678 | 114,449 |
| Throughput (req/s) | 219.5 | 293.3 |
| Upstream API calls | 85,676 | 1,514 |
| Cache hit rate | 0.00% | 99.83% |
| Latency p50 | 101.8 ms | 0.4 ms |
| Latency p95 | 119.8 ms | 0.8 ms |
| Latency p99 | n/a | n/a |
| Failed requests | 0.00% | 0.00% |

## Headline numbers

- **Upstream API calls reduced by 98.2%** (85,676 to 1,514).
- **p95 latency reduced by 99.3%** (119.8 ms to 0.8 ms).
- **Cache hit rate 99.83%** under burst load.

## Horizontal scaling

| Gateway replicas | Throughput (req/s) | Speedup | p95 latency |
|---|---|---|---|
| 1 | 2745.8 | 1.00x | 87.0 ms |
| 2 | 6066.6 | 2.21x | 56.2 ms |
| 3 | 7248.7 | 2.64x | 49.1 ms |
