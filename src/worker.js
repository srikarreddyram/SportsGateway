import http from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { createRedis } from './redis.js';
import { connectMongo, ensureIndexes } from './analytics/mongo.js';
import { startAnalyticsWorker } from './analytics/worker.js';

/**
 * Analytics worker: drains the BullMQ queue into MongoDB.
 *
 * Runs as its own process so a slow database can never add latency to, or take down, the
 * request path — the queue simply grows until the worker catches up.
 */
const workerPort = Number.parseInt(process.env.WORKER_PORT ?? '3100', 10);

const connection = createRedis({ role: 'analytics-worker', forQueue: true });
const { client: mongoClient, db } = await connectMongo();
const collection = db.collection(config.mongo.collection);
await ensureIndexes(collection);

const { worker, close } = startAnalyticsWorker({ connection, collection });

// Minimal health endpoint so Docker Compose can tell whether the worker is alive.
const health = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: worker.isRunning() ? 'ok' : 'stopped', instance: config.instanceId }));
    return;
  }
  res.writeHead(404).end();
});

health.listen(workerPort, () => {
  logger.info({ port: workerPort, queue: config.analytics.queueName }, 'analytics worker started');
});

let shuttingDown = false;

async function stop(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'analytics worker shutting down');

  health.close();
  // Close the worker first so in-flight jobs finish and the final batch is flushed
  // before the database connection goes away.
  await close();
  await mongoClient.close();
  await connection.quit();

  logger.info('analytics worker shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));
