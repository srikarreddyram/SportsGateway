/**
 * Typed errors so the gateway always answers with an intentional status code and
 * machine-readable `code`, instead of leaking an upstream failure as a bare 500.
 */
export class GatewayError extends Error {
  constructor(message, { status = 500, code = 'internal_error', expected = false, details, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    // `expected` marks errors that are a normal part of operation (bad input, missing
    // resource). The circuit breaker ignores them so client mistakes never trip it.
    this.expected = expected;
    this.details = details;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}

export class BadRequestError extends GatewayError {
  constructor(message, details) {
    super(message, { status: 400, code: 'bad_request', expected: true, details });
  }
}

export class NotFoundError extends GatewayError {
  constructor(message = 'Resource not found in upstream data', details) {
    super(message, { status: 404, code: 'not_found', expected: true, details });
  }
}

export class RateLimitError extends GatewayError {
  constructor(message, { retryAfterS = 1, scope = 'inbound' } = {}) {
    super(message, { status: 429, code: `rate_limited_${scope}`, expected: true });
    this.retryAfterS = retryAfterS;
    this.scope = scope;
  }
}

/** An upstream call failed in a way that says something about upstream health. */
export class UpstreamError extends GatewayError {
  constructor(message, { status = 502, code = 'upstream_error', upstreamStatus, expected = false, cause } = {}) {
    super(message, { status, code, expected, cause });
    this.upstreamStatus = upstreamStatus;
  }
}

export class UpstreamTimeoutError extends UpstreamError {
  constructor(message = 'Upstream request timed out') {
    super(message, { status: 504, code: 'upstream_timeout' });
  }
}

export class CircuitOpenError extends GatewayError {
  constructor(message = 'Upstream is unavailable and the circuit breaker is open') {
    super(message, { status: 503, code: 'circuit_open', expected: true });
  }
}

export function toGatewayError(err) {
  if (err instanceof GatewayError) return err;
  return new GatewayError(err?.message || 'Unexpected error', { cause: err });
}
