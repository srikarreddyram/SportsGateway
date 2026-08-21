# Local benchmark: caching before/after

Generated 2026-08-19T07:59:37.213Z.

Single gateway process, no Nginx, no replicas — 60 concurrent clients with
60ms think time, 30s per case, against the bundled mock provider.
Run `./scripts/benchmark.sh` for the full containerised measurement.

| Metric | No cache | With cache |
|---|---|---|
| Client requests served | 13,594 | 56,048 |
| Throughput (req/s) | 451.0 | 1864.8 |
| Upstream API calls | 13,594 | 296 |
| Upstream calls per 1,000 requests | 1000.0 | 5.3 |
| Latency p50 | 102.8 ms | 2.0 ms |
| Latency p95 | 121.0 ms | 3.2 ms |
| Latency p99 | 123.1 ms | 6.2 ms |

## Headline numbers

- **99.5% fewer provider calls per client request** (1000 down to 5.3 per 1,000 requests).
- **Cache hit rate 99.7%** under load.
- **p95 latency reduced by 97.3%** (121.0 ms to 3.2 ms).
- Absolute provider calls went from 13,594 to 296 (97.8% fewer), while the gateway served 56,048 requests versus 13,594.

Cache outcomes with caching on: {"MISS":190,"COALESCED":67,"HIT":55508,"STALE":283}
Response codes: baseline {"200":13594}, cached {"200":56048}
