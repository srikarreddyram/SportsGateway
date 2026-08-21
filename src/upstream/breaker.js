import CircuitBreaker from 'opossum';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { metrics, BREAKER_STATE_VALUE } from '../metrics.js';
import { CircuitOpenError, UpstreamTimeoutError } from '../errors.js';

const log = createLogger('breaker');

export const BreakerState = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'halfOpen' };

const isOpenCircuitError = (err) => err?.code === 'EOPENBREAKER' || /breaker is open/i.test(err?.message ?? '');

const isBreakerTimeout = (err) => err?.code === 'ETIMEDOUT' || /timed out after/i.test(err?.message ?? '');

/**
 * Wrap upstream calls so a slow or failing provider fails fast instead of piling up.
 *
 * Closed   -> calls pass through, failures are counted in a rolling window.
 * Open     -> calls are rejected immediately (no socket, no waiting) once the failure
 *             rate crosses the threshold; callers fall back to cached data.
 * Half-open-> after resetTimeout, one trial call decides whether to close again.
 *
 * `errorFilter` keeps expected errors (bad request, 404, upstream 4xx, quota) out of the
 * failure statistics: those say something about the caller, not about upstream health.
 */
export function createBreaker(action, { name = 'upstream', options = config.breaker } = {}) {
  if (!options.enabled) {
    return {
      name,
      enabled: false,
      fire: (...args) => action(...args),
      get state() {
        return BreakerState.CLOSED;
      },
      stats: () => ({ enabled: false }),
      shutdown: () => {},
    };
  }

  const breaker = new CircuitBreaker(action, {
    name,
    timeout: options.timeoutMs,
    errorThresholdPercentage: options.errorThresholdPercentage,
    resetTimeout: options.resetTimeoutMs,
    volumeThreshold: options.volumeThreshold,
    rollingCountTimeout: options.rollingCountTimeoutMs,
    errorFilter: (err) => err?.expected === true,
  });

  const recordState = (state) => {
    metrics.breakerState.set({ breaker: name }, BREAKER_STATE_VALUE[state]);
    metrics.breakerTransitions.inc({ breaker: name, to: state });
  };

  metrics.breakerState.set({ breaker: name }, BREAKER_STATE_VALUE.closed);

  breaker.on('open', () => {
    recordState(BreakerState.OPEN);
    log.error({ breaker: name, stats: breaker.stats }, 'circuit opened: upstream is failing, serving fallbacks');
  });
  breaker.on('halfOpen', () => {
    recordState(BreakerState.HALF_OPEN);
    log.warn({ breaker: name }, 'circuit half-open: probing upstream with a trial request');
  });
  breaker.on('close', () => {
    recordState(BreakerState.CLOSED);
    log.info({ breaker: name }, 'circuit closed: upstream recovered');
  });

  const stateOf = () => {
    if (breaker.opened) return BreakerState.OPEN;
    if (breaker.halfOpen) return BreakerState.HALF_OPEN;
    return BreakerState.CLOSED;
  };

  return {
    name,
    enabled: true,
    async fire(...args) {
      try {
        return await breaker.fire(...args);
      } catch (err) {
        // Translate opossum's own errors into the gateway's typed vocabulary so route
        // handlers only ever deal with GatewayError subclasses.
        if (isOpenCircuitError(err)) throw new CircuitOpenError();
        if (isBreakerTimeout(err)) throw new UpstreamTimeoutError();
        throw err;
      }
    },
    get state() {
      return stateOf();
    },
    stats() {
      const { failures, successes, timeouts, rejects, fires } = breaker.stats;
      return { enabled: true, state: stateOf(), failures, successes, timeouts, rejects, fires };
    },
    shutdown: () => breaker.shutdown(),
  };
}
