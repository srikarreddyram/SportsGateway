import { MongoClient } from 'mongodb';
import { config } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('analytics.mongo');

export async function connectMongo({ url = config.mongo.url, dbName = config.mongo.db } = {}) {
  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 20,
  });

  await client.connect();
  log.info({ db: dbName }, 'connected to mongodb');

  return { client, db: client.db(dbName) };
}

/**
 * Indexes are chosen for the three questions the analytics data exists to answer:
 * recent traffic, per-endpoint behaviour over time, and cache hit rate per endpoint.
 * The TTL index keeps the collection from growing without bound during load testing.
 */
export async function ensureIndexes(collection, { retentionDays = config.analytics.retentionDays } = {}) {
  await collection.createIndexes([
    { key: { timestamp: -1 }, name: 'timestamp_desc' },
    { key: { route: 1, timestamp: -1 }, name: 'route_timestamp' },
    { key: { route: 1, cacheHit: 1 }, name: 'route_cachehit' },
    { key: { statusCode: 1, timestamp: -1 }, name: 'status_timestamp' },
    {
      key: { timestamp: 1 },
      name: 'ttl_timestamp',
      expireAfterSeconds: retentionDays * 24 * 60 * 60,
    },
  ]);

  log.info({ retentionDays }, 'analytics indexes ensured');
}

/** Queue events travel as JSON, so date fields arrive as strings and need rehydrating. */
export function toDocument(event) {
  return {
    ...event,
    timestamp: new Date(event.timestamp),
    ingestedAt: new Date(),
  };
}
