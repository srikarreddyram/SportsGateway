import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { config } from '../src/config.js';
import { createRedis, scanDelete } from '../src/redis.js';
import { createTokenBucket } from '../src/ratelimit/tokenBucket.js';
import { TEST_REDIS_URL, sleep } from './helpers.js';

const prefix = `sgtest:tb:${randomUUID().slice(0, 8)}`;
let redis;
let consume;

before(async () => {
  config.redis.url = TEST_REDIS_URL;
  redis = createRedis({ role: 'tokenbucket-test' });
  consume = createTokenBucket(redis);
});

after(async () => {
  await scanDelete(redis, `${prefix}*`).catch(() => {});
  await redis.quit();
});

const key = (name) => `${prefix}:${name}`;

describe('token bucket', () => {
  test('allows a full burst up to capacity, then rejects', async () => {
    const k = key('burst');
    const limits = { capacity: 5, refillPerSec: 0.001 };

    const outcomes = [];
    for (let i = 0; i < 7; i += 1) outcomes.push((await consume(k, limits)).allowed);

    assert.deepEqual(outcomes, [true, true, true, true, true, false, false]);
  });

  test('reports the tokens left in the bucket', async () => {
    const k = key('remaining');
    const limits = { capacity: 3, refillPerSec: 0.001 };

    assert.equal((await consume(k, limits)).remaining, 2);
    assert.equal((await consume(k, limits)).remaining, 1);
    assert.equal((await consume(k, limits)).remaining, 0);
  });

  test('refills over time, which is what makes it a rate rather than a quota', async () => {
    const k = key('refill');
    const limits = { capacity: 2, refillPerSec: 20 }; // one token every 50ms

    assert.equal((await consume(k, limits)).allowed, true);
    assert.equal((await consume(k, limits)).allowed, true);
    assert.equal((await consume(k, limits)).allowed, false);

    await sleep(120);
    assert.equal((await consume(k, limits)).allowed, true);
  });

  test('never refills past capacity, so idle time cannot bank an unbounded burst', async () => {
    const k = key('cap');
    // One token per 50ms: slow enough that the burst below cannot refill mid-test,
    // fast enough that the idle period refills far past capacity.
    const limits = { capacity: 3, refillPerSec: 20 };

    await consume(k, limits);
    await sleep(400); // 8 tokens' worth of refill into a 3-token bucket

    const outcomes = [];
    for (let i = 0; i < 5; i += 1) outcomes.push((await consume(k, limits)).allowed);

    assert.deepEqual(outcomes.slice(0, 3), [true, true, true]);
    assert.equal(outcomes[3], false);
  });

  test('tells a rejected caller how long to wait', async () => {
    const k = key('retry');
    const limits = { capacity: 1, refillPerSec: 2 }; // a token every 500ms

    await consume(k, limits);
    const rejected = await consume(k, limits);

    assert.equal(rejected.allowed, false);
    assert.ok(rejected.retryAfterMs > 0 && rejected.retryAfterMs <= 500, `got ${rejected.retryAfterMs}`);
  });

  test('separate keys hold independent buckets', async () => {
    const limits = { capacity: 1, refillPerSec: 0.001 };

    assert.equal((await consume(key('client-a'), limits)).allowed, true);
    assert.equal((await consume(key('client-a'), limits)).allowed, false);
    assert.equal((await consume(key('client-b'), limits)).allowed, true);
  });

  test('concurrent consumers cannot oversubscribe the bucket', async () => {
    const k = key('atomic');
    const limits = { capacity: 10, refillPerSec: 0.001 };

    // 50 simultaneous requests against a 10-token bucket: the Lua script makes the
    // read-modify-write atomic, so exactly 10 may pass however they interleave.
    const results = await Promise.all(Array.from({ length: 50 }, () => consume(k, limits)));
    const allowed = results.filter((r) => r.allowed).length;

    assert.equal(allowed, 10);
  });

  test('sets a TTL so idle buckets do not accumulate in Redis forever', async () => {
    const k = key('ttl');
    await consume(k, { capacity: 5, refillPerSec: 1 });

    assert.ok((await redis.ttl(k)) > 0);
  });
});
