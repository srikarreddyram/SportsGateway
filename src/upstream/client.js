import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { metrics } from '../metrics.js';
import { UpstreamError, UpstreamTimeoutError } from '../errors.js';
import { createBreaker } from './breaker.js';

const log = createLogger('upstream');

/**
 * HTTP client for the third-party sports API.
 *
 * Every call goes through the circuit breaker, and every call first reserves a slot from
 * the shared outbound quota bucket. The quota reservation happens *outside* the breaker,
 * so refusing to spend quota never counts as an upstream failure.
 */
export class UpstreamClient {
  #cfg;
  #reserveSlot;
  #breaker;

  constructor({ reserveUpstreamSlot, breaker = null, upstreamConfig = config.upstream }) {
    this.#cfg = upstreamConfig;
    this.#reserveSlot = reserveUpstreamSlot;
    this.#breaker = breaker;
  }

  get breaker() {
    return this.#breaker;
  }

  /** The breaker wraps a method of this client, so it is attached after construction. */
  attachBreaker(breaker) {
    this.#breaker = breaker;
    return this;
  }

  /** Raw call, wrapped by the breaker. Exposed so the breaker can be built around it. */
  async performRequest({ route = 'unknown', path, query = {} }) {
    const url = new URL(path.replace(/^\//, ''), this.#cfg.baseUrl.replace(/\/?$/, '/'));
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const headers = { accept: 'application/json' };
    if (this.#cfg.apiKey) headers[this.#cfg.apiKeyHeader] = this.#cfg.apiKey;

    const startedAt = process.hrtime.bigint();
    const observe = (outcome) => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      metrics.upstreamRequests.inc({ route, outcome });
      metrics.upstreamDuration.observe({ route, outcome }, seconds);
      return seconds;
    };

    let response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(this.#cfg.timeoutMs) });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        observe('timeout');
        throw new UpstreamTimeoutError(`Upstream did not respond within ${this.#cfg.timeoutMs}ms`);
      }
      observe('network_error');
      throw new UpstreamError(`Upstream request failed: ${err.message}`, { cause: err });
    }

    if (!response.ok) {
      observe(`http_${response.status}`);
      throw this.#httpError(response.status);
    }

    let body;
    try {
      body = await response.json();
    } catch (err) {
      observe('bad_payload');
      throw new UpstreamError('Upstream returned a non-JSON payload', { cause: err });
    }

    // API-Sports answers 200 with a populated `errors` field for auth/quota problems.
    const providerErrors = normaliseProviderErrors(body?.errors);
    if (providerErrors.length > 0) {
      observe('provider_error');
      log.warn({ route, providerErrors }, 'upstream reported an application-level error');
      throw new UpstreamError(`Upstream rejected the request: ${providerErrors.join('; ')}`, {
        code: 'upstream_rejected',
        expected: true,
      });
    }

    observe('success');
    return body;
  }

  #httpError(status) {
    if (status === 429) {
      return new UpstreamError('Upstream rate limit reached', {
        status: 429,
        code: 'upstream_rate_limited',
        upstreamStatus: status,
        expected: true,
      });
    }
    if (status >= 400 && status < 500) {
      return new UpstreamError(`Upstream rejected the request with ${status}`, {
        status: 502,
        code: 'upstream_client_error',
        upstreamStatus: status,
        expected: true,
      });
    }
    return new UpstreamError(`Upstream returned ${status}`, {
      status: 502,
      code: 'upstream_server_error',
      upstreamStatus: status,
    });
  }

  /** Public entry point: quota reservation, then breaker-guarded call. */
  async request({ route, path, query }) {
    await this.#reserveSlot({ route });
    return this.#breaker.fire({ route, path, query });
  }
}

/** Builds the client and the circuit breaker that guards its outbound calls. */
export function createUpstreamClient({ reserveUpstreamSlot, upstreamConfig = config.upstream } = {}) {
  const client = new UpstreamClient({ reserveUpstreamSlot, upstreamConfig });
  const breaker = createBreaker((args) => client.performRequest(args), { name: 'upstream' });
  return client.attachBreaker(breaker);
}

function normaliseProviderErrors(errors) {
  if (!errors) return [];
  if (Array.isArray(errors)) return errors.map(String);
  if (typeof errors === 'object') return Object.entries(errors).map(([key, value]) => `${key}: ${value}`);
  return [String(errors)];
}
