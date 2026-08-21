import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createHarness, startMockUpstream } from './helpers.js';

/**
 * Regression cover for a real defect: the admin router applies its token guard with a
 * pathless `router.use()`, so mounting that router at the application root made the
 * guard apply to *every* route — /health, /metrics, /api/* — the moment ADMIN_TOKEN was
 * set. It went unnoticed because no test had ever set a non-empty token. These tests
 * assert both halves of the contract: admin routes are protected, and nothing else is.
 */
describe('admin authentication', () => {
  let mock;
  let h;
  const TOKEN = 'test-admin-token';

  before(async () => {
    mock = await startMockUpstream();
    h = await createHarness({ upstreamUrl: mock.url, overrides: { admin: { token: TOKEN } } });
  });

  after(async () => {
    await h?.close();
    await mock?.stop();
    config.admin.token = '';
  });

  test('rejects an admin request with no token', async () => {
    const res = await h.get('/admin/status');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthorized');
  });

  test('rejects an admin request with the wrong token', async () => {
    const res = await h.get('/admin/status', { headers: { 'x-admin-token': 'nope' } });
    assert.equal(res.status, 401);
  });

  test('accepts an admin request carrying the right token', async () => {
    const res = await h.get('/admin/status', { headers: { 'x-admin-token': TOKEN } });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.instance, 'string');
  });

  test('cache invalidation is protected too, not just the read-only status route', async () => {
    assert.equal((await h.get('/admin/cache', { method: 'DELETE' })).status, 401);
    const allowed = await h.get('/admin/cache', { method: 'DELETE', headers: { 'x-admin-token': TOKEN } });
    assert.equal(allowed.status, 200);
  });

  // The half that actually failed in production-shaped config: a set token must not
  // turn the public API and the probes into authenticated endpoints.
  for (const path of ['/health', '/ready', '/metrics', '/openapi.json', '/api/scores/215662']) {
    test(`${path} stays public while ADMIN_TOKEN is set`, async () => {
      const res = await h.get(path);
      assert.notEqual(res.status, 401, `${path} must not require the admin token`);
    });
  }
});
