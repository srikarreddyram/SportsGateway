#!/usr/bin/env node
/**
 * Caching before/after without Docker or k6.
 *
 * Starts the mock provider and a single gateway process, runs the same load twice
 * (caching off, then on), and reports the difference. It is the same measurement
 * `scripts/benchmark.sh` performs, minus Nginx, multiple replicas and the analytics
 * worker — useful for a quick, honest number on a machine without Docker, and for
 * sanity-checking the stack before committing to the full run.
 *
 *   node scripts/local-benchmark.mjs --duration 30 --concurrency 50
 *
 * Requires a Redis on REDIS_URL (default redis://127.0.0.1:6379).
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};

const DURATION_S = Number(arg('duration', 30));
const CONCURRENCY = Number(arg('concurrency', 50));
// Think time between a client's requests. Without it the generator is a closed loop and
// the cached run simply issues far more requests than the baseline, which would make the
// two runs' upstream call counts incomparable.
const THINK_MS = Number(arg('think', 50));
const MOCK_PORT = Number(arg('mock-port', 18081));
const GATEWAY_PORT = Number(arg('gateway-port', 13000));
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;

const children = new Set();

function launch(script, env) {
  const child = spawn(process.execPath, [path.join(repoRoot, script)], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk);
    if (text.includes('"level":"error"') || text.includes('"level":"fatal"')) process.stderr.write(text);
  });
  children.add(child);
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 3000;
  while (child.exitCode === null && Date.now() < deadline) await delay(50);
  if (child.exitCode === null) child.kill('SIGKILL');
  children.delete(child);
}

async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await delay(100);
  }
  throw new Error(`${url} never became healthy`);
}

// The same traffic shape the k6 scenarios use: most load on a few live matches.
const HOT_MATCHES = ['215664', '215666', '215668', '215670', '215672', '215674', '215676', '215678'];
const COLD_MATCHES = Array.from({ length: 120 }, (_, i) => String(300000 + i));
const PLAYER_IDS = Array.from({ length: 60 }, (_, i) => String(276 + i));

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

function randomTarget() {
  const roll = Math.random();
  if (roll < 0.62) return `/api/scores/${pick(HOT_MATCHES)}`;
  if (roll < 0.7) return `/api/scores/${pick(COLD_MATCHES)}`;
  if (roll < 0.85) return `/api/fixtures/${isoDate(Math.random() < 0.7 ? 0 : -1)}`;
  return `/api/players/${pick(PLAYER_IDS)}?season=2024`;
}

const percentile = (sorted, p) => {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
};

async function runLoad({ durationS, concurrency }) {
  const latencies = [];
  const cacheStatus = Object.create(null);
  const statusCodes = Object.create(null);
  const deadline = Date.now() + durationS * 1000;

  const worker = async () => {
    while (Date.now() < deadline) {
      const started = performance.now();
      try {
        const res = await fetch(`${GATEWAY_URL}${randomTarget()}`);
        await res.arrayBuffer();
        latencies.push(performance.now() - started);
        const cache = res.headers.get('x-cache') ?? 'NONE';
        cacheStatus[cache] = (cacheStatus[cache] ?? 0) + 1;
        statusCodes[res.status] = (statusCodes[res.status] ?? 0) + 1;
      } catch {
        statusCodes.error = (statusCodes.error ?? 0) + 1;
      }
      if (THINK_MS > 0) await delay(Math.random() * THINK_MS);
    }
  };

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedS = (Date.now() - startedAt) / 1000;

  latencies.sort((a, b) => a - b);
  const total = latencies.length;

  return {
    requests: total,
    throughput: total / elapsedS,
    latency: {
      avg: total ? latencies.reduce((sum, value) => sum + value, 0) / total : null,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    cacheStatus,
    statusCodes,
  };
}

async function runCase({ label, cacheEnabled }) {
  process.stdout.write(`\n==> Case '${label}' (CACHE_ENABLED=${cacheEnabled})\n`);

  const gateway = launch('src/index.js', {
    PORT: String(GATEWAY_PORT),
    REDIS_URL,
    // A per-case key prefix guarantees each run starts from a cold cache without
    // touching anything else in the developer's Redis.
    REDIS_KEY_PREFIX: `sglocal:${label}:${Date.now()}`,
    UPSTREAM_BASE_URL: MOCK_URL,
    CACHE_ENABLED: String(cacheEnabled),
    // Measured separately: leaving the limiters on would throttle the no-cache baseline
    // and turn this into a measurement of the limiter instead of the cache.
    RL_INBOUND_ENABLED: 'false',
    RL_OUTBOUND_ENABLED: 'false',
    // No MongoDB in this path, so the analytics queue would just accumulate jobs.
    ANALYTICS_ENABLED: 'false',
    LOG_LEVEL: 'error',
  });

  try {
    await waitForHealth(GATEWAY_URL);
    await fetch(`${MOCK_URL}/__stats`, { method: 'DELETE' });

    const result = await runLoad({ durationS: DURATION_S, concurrency: CONCURRENCY });
    const stats = await (await fetch(`${MOCK_URL}/__stats`)).json();

    return { label, cacheEnabled, ...result, upstreamCalls: stats.total };
  } finally {
    await stop(gateway);
  }
}

const ms = (value) => (value == null ? 'n/a' : `${value.toFixed(1)} ms`);
const int = (value) => (value == null ? 'n/a' : Math.round(value).toLocaleString('en-US'));

function report(baseline, cached) {
  const reduction = ((baseline.upstreamCalls - cached.upstreamCalls) / baseline.upstreamCalls) * 100;
  const served = Object.entries(cached.cacheStatus).reduce((sum, [, count]) => sum + count, 0);
  const hits = ['HIT', 'STALE', 'COALESCED'].reduce((sum, key) => sum + (cached.cacheStatus[key] ?? 0), 0);
  const hitRate = served ? (hits / served) * 100 : 0;
  const latencyDelta = ((baseline.latency.p95 - cached.latency.p95) / baseline.latency.p95) * 100;

  // Volume-invariant: how many provider calls each run needed per 1,000 client requests.
  // This is the honest comparison when the two runs do not serve identical request counts.
  const perThousand = (run) => (run.upstreamCalls / run.requests) * 1000;
  const baselineRatio = perThousand(baseline);
  const cachedRatio = perThousand(cached);
  const ratioReduction = ((baselineRatio - cachedRatio) / baselineRatio) * 100;

  const rows = [
    ['Client requests served', int(baseline.requests), int(cached.requests)],
    ['Throughput (req/s)', baseline.throughput.toFixed(1), cached.throughput.toFixed(1)],
    ['Upstream API calls', int(baseline.upstreamCalls), int(cached.upstreamCalls)],
    ['Upstream calls per 1,000 requests', baselineRatio.toFixed(1), cachedRatio.toFixed(1)],
    ['Latency p50', ms(baseline.latency.p50), ms(cached.latency.p50)],
    ['Latency p95', ms(baseline.latency.p95), ms(cached.latency.p95)],
    ['Latency p99', ms(baseline.latency.p99), ms(cached.latency.p99)],
  ];

  const lines = [
    '# Local benchmark: caching before/after',
    '',
    `Generated ${new Date().toISOString()}.`,
    '',
    `Single gateway process, no Nginx, no replicas — ${CONCURRENCY} concurrent clients with`,
    `${THINK_MS}ms think time, ${DURATION_S}s per case, against the bundled mock provider.`,
    'Run `./scripts/benchmark.sh` for the full containerised measurement.',
    '',
    '| Metric | No cache | With cache |',
    '|---|---|---|',
    ...rows.map(([name, before, after]) => `| ${name} | ${before} | ${after} |`),
    '',
    '## Headline numbers',
    '',
    `- **${ratioReduction.toFixed(1)}% fewer provider calls per client request** (${baselineRatio.toFixed(0)} down to ${cachedRatio.toFixed(1)} per 1,000 requests).`,
    `- **Cache hit rate ${hitRate.toFixed(1)}%** under load.`,
    `- **p95 latency ${latencyDelta >= 0 ? 'reduced' : 'increased'} by ${Math.abs(latencyDelta).toFixed(1)}%** (${ms(baseline.latency.p95)} to ${ms(cached.latency.p95)}).`,
    `- Absolute provider calls went from ${int(baseline.upstreamCalls)} to ${int(cached.upstreamCalls)} (${reduction.toFixed(1)}% fewer), while the gateway served ${int(cached.requests)} requests versus ${int(baseline.requests)}.`,
    '',
    `Cache outcomes with caching on: ${JSON.stringify(cached.cacheStatus)}`,
    `Response codes: baseline ${JSON.stringify(baseline.statusCodes)}, cached ${JSON.stringify(cached.statusCodes)}`,
    '',
  ];

  return lines.join('\n');
}

async function main() {
  const mock = launch('mock-upstream/server.js', { PORT: String(MOCK_PORT) });
  await waitForHealth(MOCK_URL);

  try {
    const baseline = await runCase({ label: 'nocache', cacheEnabled: false });
    const cached = await runCase({ label: 'cached', cacheEnabled: true });

    const markdown = report(baseline, cached);
    const outFile = path.join(repoRoot, 'results', 'local-comparison.md');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, markdown);

    process.stdout.write(`\n${markdown}\nWritten to ${path.relative(repoRoot, outFile)}\n`);
  } finally {
    await stop(mock);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    for (const child of children) await stop(child);
    process.exit(1);
  });
}

await main();
