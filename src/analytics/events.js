/**
 * Analytics event schema — one document per request served by the gateway.
 *
 * Kept flat and explicit so the MongoDB queries that answer "which endpoints spiked, and
 * how well did the cache serve them" stay simple aggregations rather than reshaping work.
 */
export function buildRequestEvent({
  requestId,
  instance,
  method,
  path,
  route,
  statusCode,
  latencyMs,
  cacheStatus,
  upstreamCalled,
  rateLimit,
  breakerState,
  clientIp,
  userAgent,
  degraded,
  errorCode,
  errorMessage,
}) {
  return {
    timestamp: new Date().toISOString(),
    requestId,
    instance,
    method,
    path,
    route: route ?? 'unknown',
    statusCode,
    latencyMs: Math.round(latencyMs * 1000) / 1000,
    cacheStatus: cacheStatus ?? 'NONE',
    // Denormalised for the hit-rate aggregation; STALE and COALESCED were both answered
    // without a blocking upstream call, so they count as hits.
    cacheHit: ['HIT', 'STALE', 'COALESCED'].includes(cacheStatus ?? ''),
    upstreamCalled: Boolean(upstreamCalled),
    rateLimit: rateLimit ?? 'ok',
    breakerState: breakerState ?? 'unknown',
    clientIp,
    userAgent,
    degraded: Boolean(degraded),
    ...(errorCode ? { errorCode, errorMessage } : {}),
  };
}
