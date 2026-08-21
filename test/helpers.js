import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { CacheStore } from '../src/cache/index.js';
import { createRedis } from '../src/redis.js';
import { createOutboundLimiter } from '../src/ratelimit/outbound.js';
import { createUpstreamClient } from '../src/upstream/client.js';
import { scanDelete } from '../src/redis.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Boots the real mock upstream and waits until it answers.
 *
 * PORT=0 lets the OS assign a free port, and the child reports which one it got on
 * stdout. Picking a random port in a fixed range instead — as this used to — leaves a
 * real collision window: `node --test` runs test files in parallel processes, so two
 * mocks can draw the same number, and the loser fails to bind. That surfaces later as
 * an unrelated-looking `SocketError: other side closed` in whichever suite lost the
 * race, which is exactly the kind of intermittent failure that erodes trust in a suite.
 */
export async function startMockUpstream() {
  const child = spawn(process.execPath, [path.join(repoRoot, 'mock-upstream', 'server.js')], {
    env: { ...process.env, PORT: '0', MOCK_BASE_LATENCY_MS: '5', MOCK_JITTER_MS: '0' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  // The mock's startup log line is the handshake that carries the assigned port.
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mock upstream did not report a port within 10s')), 10000);
    let buffered = '';

    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      for (const line of buffered.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.msg === 'listening' && parsed.port) {
            clearTimeout(timer);
            resolve(parsed.port);
            return;
          }
        } catch {
          // Partial line; wait for the rest.
        }
      }
    });

    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const url = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) break;
    } catch {
      await sleep(50);
    }
  }

  return {
    url,
    async stats() {
      return (await fetch(`${url}/__stats`)).json();
    },
    async resetStats() {
      await fetch(`${url}/__stats`, { method: 'DELETE' });
    },
    async control(patch) {
      return (
        await fetch(`${url}/__control`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
      ).json();
    },
    async stop() {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => {});
    },
  };
}

const merge = (target, patch) => {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) merge(target[key], value);
    else target[key] = value;
  }
};

/**
 * Builds the real gateway app against a real Redis and the mock upstream, so tests
 * exercise the shipped wiring rather than a stand-in for it.
 */
export async function createHarness({ upstreamUrl, overrides = {} } = {}) {
  config.redis.url = TEST_REDIS_URL;
  config.redis.keyPrefix = `sgtest:${randomUUID().slice(0, 8)}`;
  config.upstream.baseUrl = upstreamUrl;
  config.analytics.enabled = false;
  merge(config, overrides);

  const redis = createRedis({ role: 'test' });
  const cache = new CacheStore(redis);
  const reserveUpstreamSlot = createOutboundLimiter(redis);
  const upstream = createUpstreamClient({ reserveUpstreamSlot });

  // Analytics has its own dedicated test; stubbing it here keeps these tests free of
  // BullMQ and MongoDB.
  const published = [];
  const analytics = { publish: (event) => published.push(event), close: async () => {} };

  const app = createApp({ redis, cache, upstream, analytics });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    redis,
    cache,
    upstream,
    published,
    get: (path, init) => request(`${base}${path}`, init),
    async close() {
      await scanDelete(redis, `${config.redis.keyPrefix}:*`).catch(() => {});
      server.close();
      upstream.breaker.shutdown();
      await redis.quit().catch(() => {});
    },
  };
}

export async function request(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, headers: Object.fromEntries(res.headers), body };
}
