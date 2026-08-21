import { Worker } from 'bullmq';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { metrics } from '../metrics.js';
import { toDocument } from './mongo.js';

const log = createLogger('analytics.worker');

/**
 * Collects documents and writes them in one round trip.
 *
 * A load test produces thousands of events per second; one insert per event would make
 * MongoDB the bottleneck and let the queue grow without bound. Each caller's promise
 * settles only once its batch is actually persisted, so BullMQ still only acknowledges
 * jobs that reached the database.
 */
export function createBatchWriter({ flush, maxSize = 20, maxWaitMs = 500 }) {
  let pending = [];
  let waiters = [];
  let timer = null;

  async function flushNow() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;

    const batch = pending;
    const batchWaiters = waiters;
    pending = [];
    waiters = [];

    try {
      await flush(batch);
      for (const waiter of batchWaiters) waiter.resolve();
    } catch (err) {
      for (const waiter of batchWaiters) waiter.reject(err);
    }
  }

  return {
    add(doc) {
      return new Promise((resolve, reject) => {
        pending.push(doc);
        waiters.push({ resolve, reject });

        if (pending.length >= maxSize) {
          void flushNow();
        } else if (!timer) {
          timer = setTimeout(() => void flushNow(), maxWaitMs);
        }
      });
    },
    flushNow,
    get size() {
      return pending.length;
    },
  };
}

export function startAnalyticsWorker({ connection, collection, options = config.analytics }) {
  const writer = createBatchWriter({
    maxSize: options.batchSize,
    maxWaitMs: options.batchWaitMs,
    flush: async (docs) => {
      // `ordered: false` keeps one malformed document from discarding the whole batch.
      await collection.insertMany(docs, { ordered: false });
      metrics.analyticsWritten.inc(docs.length);
      log.debug({ count: docs.length }, 'analytics batch written');
    },
  });

  const worker = new Worker(
    options.queueName,
    async (job) => {
      await writer.add(toDocument(job.data));
    },
    {
      connection,
      // Concurrency must exceed the batch size, otherwise every in-flight job would be
      // waiting on a batch that can never fill.
      concurrency: Math.max(options.workerConcurrency, options.batchSize * 2),
      // A job is held until its batch flushes, so it stays "active" longer than a
      // one-shot handler would. The default 30s lock is enough in normal operation but
      // expires if the host stalls, orphaning in-flight jobs; doubling it absorbs that
      // without delaying detection of a genuinely dead worker for long.
      lockDuration: options.lockDurationMs,
    },
  );

  worker.on('failed', (job, err) => log.warn({ err, jobId: job?.id }, 'analytics job failed'));
  worker.on('error', (err) => log.error({ err }, 'analytics worker error'));
  worker.on('ready', () => log.info({ queue: options.queueName }, 'analytics worker ready'));

  return {
    worker,
    writer,
    async close() {
      await worker.close();
      await writer.flushNow();
    },
  };
}
