#!/usr/bin/env node
/**
 * Turns the raw k6 summaries and upstream call counts into the comparison table that
 * goes in RESULTS.md. Kept separate from benchmark.sh so a report can be regenerated
 * from existing results without re-running a 15-minute load test.
 *
 *   node scripts/compare.mjs [resultsDir]
 */
import fs from 'node:fs';
import path from 'node:path';

const resultsDir = process.argv[2] || 'results';

const readJson = (file) => {
  const full = path.join(resultsDir, file);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return null;
  }
};

// Both the full and the --quick benchmark label their runs identically, so the report
// is built from the same two filenames either way.
const baseline = readJson('baseline-nocache-summary.json');
const cached = readJson('cached-summary.json');
const baselineUpstream = readJson('baseline-nocache-upstream.json');
const cachedUpstream = readJson('cached-upstream.json');

if (!baseline || !cached) {
  console.error('Missing k6 summaries. Run ./scripts/benchmark.sh first.');
  process.exit(1);
}

const ms = (value) => (value == null ? 'n/a' : `${value.toFixed(1)} ms`);
const pct = (value) => (value == null ? 'n/a' : `${(value * 100).toFixed(2)}%`);
const int = (value) => (value == null ? 'n/a' : Math.round(value).toLocaleString('en-US'));

const upstreamBefore = baselineUpstream?.upstreamCalls ?? null;
const upstreamAfter = cachedUpstream?.upstreamCalls ?? null;
const reduction =
  upstreamBefore && upstreamAfter != null ? ((upstreamBefore - upstreamAfter) / upstreamBefore) * 100 : null;

const latencyDelta =
  baseline.latencyMs.p95 && cached.latencyMs.p95
    ? ((baseline.latencyMs.p95 - cached.latencyMs.p95) / baseline.latencyMs.p95) * 100
    : null;

const rows = [
  ['Client requests served', int(baseline.requests), int(cached.requests)],
  [
    'Throughput (req/s)',
    baseline.requestsPerSecond?.toFixed(1) ?? 'n/a',
    cached.requestsPerSecond?.toFixed(1) ?? 'n/a',
  ],
  ['Upstream API calls', int(upstreamBefore), int(upstreamAfter)],
  ['Cache hit rate', pct(baseline.cache.hitRate), pct(cached.cache.hitRate)],
  ['Latency p50', ms(baseline.latencyMs.p50), ms(cached.latencyMs.p50)],
  ['Latency p95', ms(baseline.latencyMs.p95), ms(cached.latencyMs.p95)],
  ['Latency p99', ms(baseline.latencyMs.p99), ms(cached.latencyMs.p99)],
  ['Failed requests', pct(baseline.failedRate), pct(cached.failedRate)],
];

const lines = [
  '# Load test results: caching before/after',
  '',
  `Generated ${new Date().toISOString()} from \`${resultsDir}/\`.`,
  '',
  'Both runs execute the identical live-match burst scenario against the identical stack.',
  'The only difference is `CACHE_ENABLED`. Upstream call counts are read from the provider,',
  'not from the gateway, so they cannot be flattered by gateway-side accounting.',
  '',
  '| Metric | No cache | With cache |',
  '|---|---|---|',
  ...rows.map(([name, before, after]) => `| ${name} | ${before} | ${after} |`),
  '',
  '## Headline numbers',
  '',
];

if (reduction != null) {
  lines.push(
    `- **Upstream API calls reduced by ${reduction.toFixed(1)}%** (${int(upstreamBefore)} to ${int(upstreamAfter)}).`,
  );
}
if (latencyDelta != null) {
  const direction = latencyDelta >= 0 ? 'reduced' : 'increased';
  lines.push(
    `- **p95 latency ${direction} by ${Math.abs(latencyDelta).toFixed(1)}%** (${ms(baseline.latencyMs.p95)} to ${ms(cached.latencyMs.p95)}).`,
  );
}
lines.push(`- **Cache hit rate ${pct(cached.cache.hitRate)}** under burst load.`);

const scaling = ['scaling-1x', 'scaling-2x', 'scaling-3x']
  .map((name) => ({ name, data: readJson(`${name}-summary.json`) }))
  .filter((entry) => entry.data);

if (scaling.length > 1) {
  const base = scaling[0].data.requestsPerSecond;
  lines.push(
    '',
    '## Horizontal scaling',
    '',
    '| Gateway replicas | Throughput (req/s) | Speedup | p95 latency |',
    '|---|---|---|---|',
    ...scaling.map(({ name, data }) => {
      const replicas = name.replace('scaling-', '').replace('x', '');
      const speedup = base ? `${(data.requestsPerSecond / base).toFixed(2)}x` : 'n/a';
      return `| ${replicas} | ${data.requestsPerSecond?.toFixed(1) ?? 'n/a'} | ${speedup} | ${ms(data.latencyMs.p95)} |`;
    }),
  );
}

const failure = readJson('failure-summary.json');
if (failure) {
  lines.push(
    '',
    '## Upstream failure behaviour',
    '',
    `- Requests served from last-known-good cache during the outage: **${int(failure.cache.fallbackServed)}**`,
    `- Responses flagged degraded: **${int(failure.degradedResponses)}**`,
    `- 5xx returned to clients: **${int(failure.serverErrors)}**`,
    `- p95 latency during the run: **${ms(failure.latencyMs.p95)}**`,
  );
}

console.log(lines.join('\n'));
