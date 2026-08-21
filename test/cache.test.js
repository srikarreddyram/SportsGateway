import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { config } from '../src/config.js';
import { createRedis, scanDelete } from '../src/redis.js';
import { CacheStore, Freshness } from '../src/cache/index.js';
import { TEST_REDIS_URL, sleep } from './helpers.js';

const prefix = `sgtest:cache:${randomUUID().slice(0, 8)}`;
let redis;
let cache;

const cacheOptions = {
  enabled: true,
  fallbackTtlS: 60,
  swrWindowS: 1,
  swrEnabled: true,
  negativeTtlS: 1,
  lockTtlMs: 2000,
  fillWaitMs: 500,
  fillPollMs: 20,
  ttl: config.cache.ttl,
};

before(async () => {
  config.redis.url = TEST_REDIS_URL;
  redis = createRedis({ role: 'cache-test' });
  cache = new CacheStore(redis, cacheOptions);
});

after(async () => {
  await scanDelete(redis, `${prefix}*`).catch(() => {});
  await redis.quit();
});

const key = (name) => `${prefix}:${name}`;

describe('cache freshness zones', () => {
  test('returns null for a key that was never written', async () => {
    assert.equal(await cache.read(key('absent')), null);
  });

  test('a freshly written entry reads back as fresh', async () => {
    const k = key('fresh');
    await cache.write(k, { data: { score: '1-0' }, ttlS: 10 });
    const entry = await cache.read(k);

    assert.equal(entry.freshness, Freshness.FRESH);
    assert.deepEqual(entry.data, { score: '1-0' });
    assert.equal(entry.notFound, false);
  });

  test('moves fresh -> stale -> expired as its freshness window elapses', async () => {
    const k = key('aging');
    const writtenAt = Date.now();
    await cache.write(k, { data: { score: '1-0' }, ttlS: 1 }, writtenAt);

    assert.equal((await cache.read(k, writtenAt + 500)).freshness, Freshness.FRESH);
    // Past the TTL but inside the 1s stale-while-revalidate window.
    assert.equal((await cache.read(k, writtenAt + 1500)).freshness, Freshness.STALE);
    // Past TTL + SWR window: must be refetched, but is still readable as a fallback.
    const expired = await cache.read(k, writtenAt + 2500);
    assert.equal(expired.freshness, Freshness.EXPIRED);
    assert.deepEqual(expired.data, { score: '1-0' });
  });

  test('keeps the entry in Redis beyond its freshness so fallbacks have data', async () => {
    const k = key('outlives');
    await cache.write(k, { data: { a: 1 }, ttlS: 1 });

    const ttl = await redis.ttl(k);
    assert.ok(ttl > 1, `expected Redis TTL to exceed the 1s freshness window, got ${ttl}`);
  });

  test('negative entries are marked and use the shorter negative TTL', async () => {
    const k = key('missing');
    const envelope = await cache.write(k, { data: null, ttlS: 999, notFound: true });

    assert.equal(envelope.ttlS, cacheOptions.negativeTtlS);
    assert.equal((await cache.read(k)).notFound, true);
  });

  test('discards an unparseable envelope instead of failing the request', async () => {
    const k = key('corrupt');
    await redis.set(k, 'not json');

    assert.equal(await cache.read(k), null);
    assert.equal(await redis.get(k), null);
  });
});

describe('stampede lock', () => {
  test('only one caller acquires the lock for a key', async () => {
    const k = key('lock');
    const first = await cache.acquireLock(k);
    const second = await cache.acquireLock(k);

    assert.ok(first);
    assert.equal(second, null);

    await cache.releaseLock(k, first);
    assert.ok(await cache.acquireLock(k));
  });

  test('a stale token cannot release a lock someone else now holds', async () => {
    const k = key('lock-token');
    const mine = await cache.acquireLock(k);

    assert.equal(await cache.releaseLock(k, 'someone-elses-token'), false);
    assert.equal(await cache.releaseLock(k, mine), true);
  });

  test('waitForFill resolves once the lock winner writes the value', async () => {
    const k = key('fill');
    setTimeout(() => void cache.write(k, { data: { filled: true }, ttlS: 10 }), 60);

    const filled = await cache.waitForFill(k);
    assert.deepEqual(filled.data, { filled: true });
  });

  test('waitForFill gives up rather than waiting forever', async () => {
    const started = Date.now();
    const filled = await cache.waitForFill(key('never'), { waitMs: 150, pollMs: 20 });

    assert.equal(filled, null);
    assert.ok(Date.now() - started < 1000);
  });

  test('a lock expires on its own so a crashed holder cannot block a key', async () => {
    const k = key('lock-expiry');
    await cache.acquireLock(k, 100);

    assert.equal(await cache.acquireLock(k, 100), null);
    await sleep(150);
    assert.ok(await cache.acquireLock(k, 100));
  });
});
