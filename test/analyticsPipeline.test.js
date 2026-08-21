import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { config } from '../src/config.js';
import { createRedis, scanDelete } from '../src/redis.js';
import { AnalyticsQueue } from '../src/analytics/queue.js';
import { startAnalyticsWorker } from '../src/analytics/worker.js';
import { buildRequestEvent } from '../src/analytics/events.js';
import { TEST_REDIS_URL, sleep } from './helpers.js';

/**
 * Producer -> BullMQ -> worker -> document store, over a real Redis.
 *
 * MongoDB is stubbed with a collection double: the point here is the queue wiring and
 * batching, and the driver's own insert behaviour is not this project's to prove.
 */
const queueName = `test-analytics-${randomUUID().slice(0, 8)}`;

let producerConnection;
let workerConnection;
let queue;
let handle;
const written = [];

const collection = {
  async insertMany(docs) {
    written.push(...docs);
    return { insertedCount: docs.length };
  },
};

const options = {
  ...config.analytics,
  enabled: true,
  queueName,
  batchSize: 5,
  batchWaitMs: 100,
  workerConcurrency: 20,
  sampleRate: 1,
};

const waitFor = async (predicate, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(25);
  }
  return false;
};

const sampleEvent = (path) =>
  buildRequestEvent({
    requestId: randomUUID(),
    instance: 'gateway-test',
    method: 'GET',
    path,
    route: 'scores',
    statusCode: 200,
    latencyMs: 4.2,
    cacheStatus: 'HIT',
    upstreamCalled: false,
    rateLimit: 'ok',
    breakerState: 'closed',
    clientIp: '10.0.0.5',
  });

before(async () => {
  config.redis.url = TEST_REDIS_URL;
  producerConnection = createRedis({ role: 'test-producer', forQueue: true });
  workerConnection = createRedis({ role: 'test-worker', forQueue: true });

  queue = new AnalyticsQueue({ connection: producerConnection, options });
  handle = startAnalyticsWorker({ connection: workerConnection, collection, options });
});

after(async () => {
  await handle.close();
  await queue.close();
  await scanDelete(producerConnection, `bull:${queueName}:*`).catch(() => {});
  await producerConnection.quit();
  await workerConnection.quit();
});

describe('analytics pipeline', () => {
  test('events published by the gateway reach the document store', async () => {
    written.length = 0;
    for (let i = 0; i < 12; i += 1) queue.publish(sampleEvent(`/api/scores/${i}`));

    assert.ok(await waitFor(() => written.length >= 12), `only ${written.length} of 12 events were written`);

    const doc = written.find((d) => d.path === '/api/scores/3');
    assert.ok(doc, 'each published event should arrive exactly once');
    assert.equal(doc.route, 'scores');
    assert.equal(doc.cacheHit, true);
    assert.ok(doc.timestamp instanceof Date, 'the worker rehydrates the timestamp for MongoDB');
    assert.ok(doc.ingestedAt instanceof Date);
  });

  test('publishing is fire-and-forget and does not block the caller', async () => {
    const started = process.hrtime.bigint();
    for (let i = 0; i < 50; i += 1) queue.publish(sampleEvent(`/api/players/${i}`));
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.ok(elapsedMs < 50, `enqueuing 50 events took ${elapsedMs.toFixed(1)}ms on the response path`);
    assert.ok(await waitFor(() => written.length >= 62));
  });

  test('a disabled queue silently drops events instead of failing requests', async () => {
    const disabled = new AnalyticsQueue({ connection: producerConnection, options: { ...options, enabled: false } });

    assert.equal(disabled.enabled, false);
    assert.doesNotThrow(() => disabled.publish(sampleEvent('/api/scores/999')));
    await disabled.close();
  });
});
