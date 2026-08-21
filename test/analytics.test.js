import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { createBatchWriter } from '../src/analytics/worker.js';
import { buildRequestEvent } from '../src/analytics/events.js';
import { toDocument } from '../src/analytics/mongo.js';

describe('analytics event schema', () => {
  test('records the fields the MongoDB aggregations rely on', () => {
    const event = buildRequestEvent({
      requestId: 'req-1',
      instance: 'gateway-2',
      method: 'GET',
      path: '/api/scores/215662',
      route: 'scores',
      statusCode: 200,
      latencyMs: 12.3456,
      cacheStatus: 'HIT',
      upstreamCalled: false,
      rateLimit: 'ok',
      breakerState: 'closed',
      clientIp: '10.0.0.1',
    });

    assert.equal(event.route, 'scores');
    assert.equal(event.cacheHit, true);
    assert.equal(event.upstreamCalled, false);
    assert.equal(event.latencyMs, 12.346, 'latency is rounded to microseconds, not truncated to ms');
    assert.ok(!Number.isNaN(Date.parse(event.timestamp)));
  });

  test('counts stale and coalesced responses as hits, since neither waited on upstream', () => {
    for (const status of ['HIT', 'STALE', 'COALESCED']) {
      assert.equal(buildRequestEvent({ cacheStatus: status }).cacheHit, true, status);
    }
    for (const status of ['MISS', 'BYPASS', 'FALLBACK']) {
      assert.equal(buildRequestEvent({ cacheStatus: status }).cacheHit, false, status);
    }
  });

  test('carries error details only when the request actually failed', () => {
    const ok = buildRequestEvent({ cacheStatus: 'HIT' });
    const failed = buildRequestEvent({ cacheStatus: 'MISS', errorCode: 'upstream_timeout', errorMessage: 'boom' });

    assert.equal('errorCode' in ok, false);
    assert.equal(failed.errorCode, 'upstream_timeout');
  });

  test('rehydrates the timestamp so MongoDB can index and expire it', () => {
    const doc = toDocument(buildRequestEvent({ cacheStatus: 'HIT' }));

    assert.ok(doc.timestamp instanceof Date);
    assert.ok(doc.ingestedAt instanceof Date);
  });
});

describe('analytics batch writer', () => {
  test('flushes as soon as a full batch is available', async () => {
    const batches = [];
    const writer = createBatchWriter({
      maxSize: 3,
      maxWaitMs: 10000,
      flush: async (docs) => batches.push(docs.length),
    });

    await Promise.all([writer.add({ a: 1 }), writer.add({ a: 2 }), writer.add({ a: 3 })]);

    assert.deepEqual(batches, [3]);
  });

  test('flushes a partial batch once the wait window elapses', async () => {
    const batches = [];
    const writer = createBatchWriter({ maxSize: 100, maxWaitMs: 50, flush: async (docs) => batches.push(docs.length) });

    await Promise.all([writer.add({ a: 1 }), writer.add({ a: 2 })]);

    assert.deepEqual(batches, [2], 'a quiet period must not strand events in memory');
  });

  test('resolves each caller only after its batch is persisted', async () => {
    let persisted = false;
    const writer = createBatchWriter({
      maxSize: 1,
      maxWaitMs: 10,
      flush: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        persisted = true;
      },
    });

    await writer.add({ a: 1 });
    assert.equal(persisted, true, 'the queue job must not be acknowledged before the write lands');
  });

  test('propagates a write failure so the job is retried rather than silently lost', async () => {
    const writer = createBatchWriter({
      maxSize: 1,
      maxWaitMs: 10,
      flush: async () => {
        throw new Error('mongo down');
      },
    });

    await assert.rejects(() => writer.add({ a: 1 }), /mongo down/);
  });

  test('a failed batch does not poison later batches', async () => {
    let attempt = 0;
    const writer = createBatchWriter({
      maxSize: 1,
      maxWaitMs: 10,
      flush: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('transient');
      },
    });

    await assert.rejects(() => writer.add({ a: 1 }));
    await writer.add({ a: 2 });
    assert.equal(attempt, 2);
  });
});
