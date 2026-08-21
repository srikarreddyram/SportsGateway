import { Queue } from 'bullmq';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { metrics } from '../metrics.js';

const log = createLogger('analytics.queue');

/**
 * Analytics producer.
 *
 * Events are pushed onto a Redis-backed queue instead of written to MongoDB inline, so
 * logging never sits on the client's latency path. `publish` is deliberately synchronous
 * and fire-and-forget: the response has already been sent, and a queue problem must
 * never turn into a failed request.
 */
export class AnalyticsQueue {
  #queue = null;
  #options;

  constructor({ connection, options = config.analytics } = {}) {
    this.#options = options;

    if (!options.enabled) {
      log.info('analytics disabled');
      return;
    }

    this.#queue = new Queue(options.queueName, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 1000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
      },
    });

    this.#queue.on('error', (err) => log.error({ err }, 'analytics queue error'));
  }

  get enabled() {
    return this.#queue !== null;
  }

  publish(event) {
    if (!this.#queue) {
      metrics.analyticsEvents.inc({ outcome: 'disabled' });
      return;
    }

    // Sampling exists for production-scale traffic; the portfolio load tests run at 1.0
    // so every request is measurable.
    if (this.#options.sampleRate < 1 && Math.random() > this.#options.sampleRate) {
      metrics.analyticsEvents.inc({ outcome: 'sampled_out' });
      return;
    }

    this.#queue
      .add('request', event)
      .then(() => metrics.analyticsEvents.inc({ outcome: 'enqueued' }))
      .catch((err) => {
        metrics.analyticsEvents.inc({ outcome: 'failed' });
        log.warn({ err }, 'failed to enqueue analytics event');
      });
  }

  async close() {
    if (this.#queue) await this.#queue.close();
  }
}
