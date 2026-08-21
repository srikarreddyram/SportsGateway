# 4. Analytics through a queue rather than on the response path

**Status:** Accepted

## Context

Every request should produce an analytics record: endpoint, latency, cache outcome,
breaker state, client, status. That data is what makes capacity planning and TTL tuning
evidence-based instead of guesswork.

The naive implementation writes to MongoDB inside the request handler. That puts a
database write — and MongoDB's availability — directly on the client-facing latency path,
in a service whose entire selling point is a sub-millisecond cached response. A 20 ms
write would be 25× the p95 it is attached to.

## Decision

Request handlers publish an event to a BullMQ queue (Redis-backed, already a dependency)
and return immediately without awaiting the write. A separate worker process consumes the
queue and writes to MongoDB in batches.

Publishing is fire-and-forget by design: if the queue is unavailable, the event is dropped
and the request still succeeds. Analytics is valuable, but it is not worth failing a
client request over — an explicit and deliberate ordering of priorities.

Batching in the worker rather than one insert per event: at a few hundred events per
second, per-document round-trips dominate, and the batch boundary is also the natural
retry unit.

## Consequences

**What it costs.** Analytics is eventually consistent — a record may not be queryable for
a moment after the request completes, so this data cannot be read back synchronously.
Under sustained overload the queue can grow, which is why the dashboard plots enqueued
events against documents written: a persistent gap between those two lines is the signal
that the worker is falling behind. And because publishing is fire-and-forget, dropped
events are possible under Redis failure, which is a deliberate accuracy-for-availability
trade rather than an oversight.

**What it bought.** Across the full load-test campaign the pipeline wrote **5,417,810**
events to MongoDB, every one with status 200, while the gateway held p95 at 0.8 ms on
cache hits — the response path never paid for the logging. The independent-measurement
value is real too: MongoDB recorded exactly 2,551 FALLBACK responses during the outage
run, matching k6's client-side count of 2,551 precisely. Two unrelated measurement paths
agreeing exactly is good evidence neither is dropping data.
