# 3. Per-instance circuit breaker, not shared state

**Status:** Accepted

## Context

The gateway wraps every upstream call in a circuit breaker so a degraded provider fails
fast instead of consuming a request slot for the full timeout. Cache and rate-limit state
are deliberately shared through Redis so replicas behave as one system — which raises the
obvious question of whether breaker state should be shared too.

## Decision

Each instance keeps its own breaker state, in memory, via `opossum`. Breaker state is
**not** replicated through Redis.

The reasoning is that breaker state answers a local question: _"are my calls to upstream
failing?"_ That can legitimately differ per instance — a replica with a broken DNS
resolver, an exhausted socket pool, or a network partition to the provider is genuinely
unhealthy in a way its peers are not. Sharing the state would let one sick instance trip
the breaker for healthy ones, converting a partial degradation into a total one.

It also keeps the hot path free of a Redis round-trip on every upstream call, and avoids
the distributed-consensus problem of who is allowed to send the half-open probe.

## Consequences

**What it costs.** Recovery is per-instance, so during an outage each replica independently
discovers the provider is back, and each sends its own half-open probe. With N replicas the
provider receives N probes per reset interval instead of one. At this project's scale that
is trivially cheap; at hundreds of replicas it would need revisiting.

It also means a dashboard reading `max(gateway_circuit_breaker_state)` shows the _worst_
replica, which can look alarming when only one instance is affected. That is why the
dashboard also carries a per-instance transitions panel rather than only the aggregate.

**What it bought.** Measured during the injected-outage run: 12 transitions to open and 12
to half-open across 2 replicas — 6 cycles each, independently — and every breaker returned
to closed after recovery. Critically, only **37** requests reached the failing provider
while **43,832** client requests were served, with **zero** client-visible errors. The
breaker absorbed the failure instead of forwarding it 43,832 times.
