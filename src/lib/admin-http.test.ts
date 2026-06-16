import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminHttpError, adminJson, shouldRetryAdminQuery } from './admin-http';

describe('adminJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed JSON for successful admin responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, count: 3 }), { status: 200 })),
    );

    await expect(adminJson<{ ok: boolean; count: number }>('/api/admin/example')).resolves.toEqual({
      ok: true,
      count: 3,
    });
    expect(fetch).toHaveBeenCalledWith('/api/admin/example', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('throws a typed error with status and payload for failed responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })),
    );

    await expect(adminJson('/api/admin/private')).rejects.toMatchObject({
      name: 'AdminHttpError',
      status: 403,
      payload: { error: 'forbidden' },
    });
  });

  it('adds JSON content type only when a body is present', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await adminJson('/api/admin/example', { method: 'POST', body: JSON.stringify({ name: 'test' }) });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });
});

describe('shouldRetryAdminQuery', () => {
  it('does not retry ordinary client errors', () => {
    const error = new AdminHttpError('fetch 400', { status: 400, url: '/api/admin/example', payload: null });
    expect(shouldRetryAdminQuery(0, error)).toBe(false);
  });

  it('retries transient and server errors up to two failures', () => {
    const rateLimited = new AdminHttpError('fetch 429', { status: 429, url: '/api/admin/example', payload: null });
    const serverError = new AdminHttpError('fetch 500', { status: 500, url: '/api/admin/example', payload: null });

    expect(shouldRetryAdminQuery(0, rateLimited)).toBe(true);
    expect(shouldRetryAdminQuery(1, serverError)).toBe(true);
    expect(shouldRetryAdminQuery(2, serverError)).toBe(false);
  });
});
