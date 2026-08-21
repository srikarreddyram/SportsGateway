import { createLogger } from '../logger.js';
import { GatewayError, RateLimitError, toGatewayError } from '../errors.js';

const log = createLogger('error');

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'route_not_found', message: `No gateway route matches ${req.method} ${req.path}` },
  });
}

/**
 * Terminal error handler. Every failure leaves as a typed JSON body with a deliberate
 * status code, so clients can distinguish "you sent something wrong" (4xx) from
 * "upstream is degraded, retry later" (503/504) without parsing prose.
 */
export function createErrorHandler() {
  // eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
  return function errorHandler(err, req, res, next) {
    const error = toGatewayError(err);

    req.ctx?.set({ errorCode: error.code, errorMessage: error.message });
    if (error instanceof RateLimitError) {
      req.ctx?.set({ rateLimit: `${error.scope}_rejected` });
      res.set('Retry-After', String(error.retryAfterS));
    }

    if (error.status >= 500 || !(err instanceof GatewayError)) {
      log.error({ err: error, requestId: req.ctx?.requestId, path: req.originalUrl }, 'unhandled gateway error');
    }

    if (res.headersSent) return res.end();
    return res.status(error.status).json(error.toJSON());
  };
}
