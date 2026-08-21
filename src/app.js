import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { createRequestContext } from './middleware/requestContext.js';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createInboundRateLimiter } from './ratelimit/inbound.js';
import { createHealthRouter } from './routes/health.js';
import { createAdminRouter } from './routes/admin.js';
import { createProxyRouter } from './routes/proxy.js';
import { createDocsRouter } from './routes/docs.js';

const log = createLogger('app');

/**
 * Wires the gateway. Every dependency is injected so tests can drive the real app with
 * a real Redis and a stub upstream, rather than testing a re-implementation of it.
 */
export function createApp({ redis, cache, upstream, analytics }) {
  const app = express();

  // Behind Nginx, so req.ip must come from X-Forwarded-For for per-client rate limiting.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.disable('etag');

  // contentSecurityPolicy is off deliberately: this process serves both a JSON API and,
  // at /docs, an HTML Swagger UI, and helmet's default CSP is written for pages that
  // don't also need to load their own inline-bootstrapped assets. The JSON responses
  // carry no HTML to inject in the first place, so a CSP is protecting a surface that
  // doesn't exist on those routes and only gets in the way on the one that does.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.cors.origin === '*' ? '*' : config.cors.origin.split(',') }));

  if (config.env === 'production' && !config.admin.token) {
    log.warn(
      'ADMIN_TOKEN is not set in production — /admin/* endpoints (including cache invalidation) are unauthenticated. Set ADMIN_TOKEN to close this.',
    );
  }

  app.use(express.json({ limit: '64kb' }));

  app.use(createRequestContext({ analytics, getBreakerState: () => upstream.breaker.state }));

  // Health, metrics and admin sit ahead of the limiter: probes and scrapes must never be
  // throttled, and cache-busting during a demo must not be rate limited either.
  app.use(createHealthRouter({ redis, upstream }));
  // Mounted at a path prefix, not the root: the admin router's own token guard is
  // `router.use()` with no path, so it applies to every request the router receives.
  // Mounting the router itself at '/' would make that guard apply to the entire app —
  // /health, /docs, /api/* — instead of only /admin/*, the moment ADMIN_TOKEN is set.
  app.use('/admin', createAdminRouter({ redis, cache, upstream }));
  app.use(createDocsRouter());

  app.use('/api', createInboundRateLimiter(redis));
  app.use(createProxyRouter({ cache, upstream }));

  app.use(notFoundHandler);
  app.use(createErrorHandler());

  return app;
}
