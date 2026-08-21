import os from 'node:os';

const readString = (name, fallback) => {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
};

const readInt = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Env ${name} must be an integer, got "${raw}"`);
  return parsed;
};

const readFloat = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return parsed;
};

const readBool = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};

export const config = {
  env: readString('NODE_ENV', 'development'),
  port: readInt('PORT', 3000),
  instanceId: readString('INSTANCE_ID', os.hostname()),
  logLevel: readString('LOG_LEVEL', 'info'),
  logPretty: readBool('LOG_PRETTY', false),
  // Nginx sits in front of the gateway, so the client IP arrives in X-Forwarded-For.
  trustProxy: readInt('TRUST_PROXY_HOPS', 1),
  shutdownGraceMs: readInt('SHUTDOWN_GRACE_MS', 10000),

  upstream: {
    baseUrl: readString('UPSTREAM_BASE_URL', 'http://localhost:8081'),
    apiKey: readString('UPSTREAM_API_KEY', ''),
    apiKeyHeader: readString('UPSTREAM_API_KEY_HEADER', 'x-apisports-key'),
    timeoutMs: readInt('UPSTREAM_TIMEOUT_MS', 4000),
    defaultSeason: readString('UPSTREAM_DEFAULT_SEASON', String(new Date().getUTCFullYear())),
  },

  redis: {
    url: readString('REDIS_URL', 'redis://localhost:6379'),
    keyPrefix: readString('REDIS_KEY_PREFIX', 'sg'),
  },

  mongo: {
    url: readString('MONGO_URL', 'mongodb://localhost:27017'),
    db: readString('MONGO_DB', 'sportsgateway'),
    collection: readString('MONGO_COLLECTION', 'request_events'),
  },

  cache: {
    // Flipping this to false is how the Milestone 9 "no cache" baseline is measured.
    enabled: readBool('CACHE_ENABLED', true),
    // How long an entry physically lives in Redis. Outlives its freshness window so a
    // degraded upstream can still be answered with a last-known-good value.
    fallbackTtlS: readInt('CACHE_FALLBACK_TTL_S', 3600),
    // Window after freshness expiry during which a stale value is served immediately
    // while a background refresh runs (stale-while-revalidate).
    swrWindowS: readInt('CACHE_SWR_WINDOW_S', 30),
    swrEnabled: readBool('CACHE_SWR_ENABLED', true),
    negativeTtlS: readInt('CACHE_NEGATIVE_TTL_S', 30),
    lockTtlMs: readInt('CACHE_LOCK_TTL_MS', 5000),
    // A request that loses the stampede lock waits this long for the winner to fill
    // the cache before giving up and calling upstream itself.
    fillWaitMs: readInt('CACHE_FILL_WAIT_MS', 400),
    fillPollMs: readInt('CACHE_FILL_POLL_MS', 25),
    ttl: {
      // Volatility-tuned: a live score changes every few seconds, a finished match never does.
      scores: readInt('CACHE_TTL_SCORES_S', 10),
      fixtures: readInt('CACHE_TTL_FIXTURES_S', 300),
      players: readInt('CACHE_TTL_PLAYERS_S', 3600),
      finished: readInt('CACHE_TTL_FINISHED_S', 21600),
    },
  },

  rateLimit: {
    inbound: {
      enabled: readBool('RL_INBOUND_ENABLED', true),
      capacity: readInt('RL_INBOUND_CAPACITY', 60),
      refillPerSec: readFloat('RL_INBOUND_REFILL_PER_SEC', 10),
    },
    outbound: {
      enabled: readBool('RL_OUTBOUND_ENABLED', true),
      // Sized to the upstream provider's quota, shared by every gateway instance.
      capacity: readInt('RL_OUTBOUND_CAPACITY', 100),
      refillPerSec: readFloat('RL_OUTBOUND_REFILL_PER_SEC', 1.6),
    },
  },

  breaker: {
    enabled: readBool('BREAKER_ENABLED', true),
    timeoutMs: readInt('BREAKER_TIMEOUT_MS', 4500),
    errorThresholdPercentage: readInt('BREAKER_ERROR_THRESHOLD_PCT', 50),
    resetTimeoutMs: readInt('BREAKER_RESET_TIMEOUT_MS', 10000),
    volumeThreshold: readInt('BREAKER_VOLUME_THRESHOLD', 5),
    rollingCountTimeoutMs: readInt('BREAKER_ROLLING_WINDOW_MS', 10000),
  },

  analytics: {
    enabled: readBool('ANALYTICS_ENABLED', true),
    queueName: readString('ANALYTICS_QUEUE_NAME', 'analytics'),
    sampleRate: readFloat('ANALYTICS_SAMPLE_RATE', 1),
    workerConcurrency: readInt('ANALYTICS_WORKER_CONCURRENCY', 40),
    batchSize: readInt('ANALYTICS_BATCH_SIZE', 20),
    batchWaitMs: readInt('ANALYTICS_BATCH_WAIT_MS', 500),
    lockDurationMs: readInt('ANALYTICS_LOCK_DURATION_MS', 60000),
    retentionDays: readInt('ANALYTICS_RETENTION_DAYS', 7),
  },

  metrics: {
    enabled: readBool('METRICS_ENABLED', true),
    collectDefault: readBool('METRICS_COLLECT_DEFAULT', true),
  },

  admin: {
    token: readString('ADMIN_TOKEN', ''),
  },

  cors: {
    // '*' is the deliberate default: every route this gateway serves is public, read-only
    // sports data with no cookies or bearer auth involved, so there is no cross-origin
    // credential to protect — the same reasoning a public CDN or read API relies on. Set
    // CORS_ORIGIN to a comma-separated allowlist to restrict it for a specific deployment.
    origin: readString('CORS_ORIGIN', '*'),
  },
};

/** Config snapshot safe to expose over HTTP (no secrets). */
export function publicConfig() {
  return {
    instanceId: config.instanceId,
    env: config.env,
    upstream: {
      baseUrl: config.upstream.baseUrl,
      timeoutMs: config.upstream.timeoutMs,
      apiKeyConfigured: config.upstream.apiKey !== '',
    },
    cache: config.cache,
    rateLimit: config.rateLimit,
    breaker: config.breaker,
    analytics: { enabled: config.analytics.enabled, sampleRate: config.analytics.sampleRate },
  };
}
