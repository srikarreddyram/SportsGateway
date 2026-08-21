import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from './api';

const mockFetch = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('returns the gateway envelope intact, meta included', async () => {
    mockFetch(200, { meta: { cache: 'HIT', ageMs: 0, instance: 'gw-1', requestId: 'r1' }, data: { match: {} } });
    const res = await api.match(1001);
    expect(res.meta.cache).toBe('HIT');
  });

  it('preserves the gateway typed error code rather than flattening it to a string', async () => {
    mockFetch(404, { error: { code: 'not_found', message: 'No scores data for "9"' } });
    await expect(api.match(9)).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('still throws a usable ApiError when the body is not the expected JSON shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );
    const err = await api.match(1).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('unknown_error');
  });

  it('omits the season query entirely when not given, so the gateway applies its default', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ meta: {}, data: {} }) });
    vi.stubGlobal('fetch', spy);
    await api.player(276);
    expect(spy).toHaveBeenCalledWith('/api/players/276');
  });

  it('passes the season through when given, since it is part of the cache key', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ meta: {}, data: {} }) });
    vi.stubGlobal('fetch', spy);
    await api.player(276, 2023);
    expect(spy).toHaveBeenCalledWith('/api/players/276?season=2023');
  });
});
