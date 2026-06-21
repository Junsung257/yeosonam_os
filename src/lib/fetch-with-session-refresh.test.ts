import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchWithSessionRefresh } from './fetch-with-session-refresh';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

describe('fetchWithSessionRefresh', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a clear re-login response when token refresh fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'TOKEN_EXPIRED', error: 'token expired' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'refresh failed' }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSessionRefresh('/api/upload', { method: 'POST', body: 'raw' });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe('SESSION_EXPIRED_NEEDS_LOGIN');
    expect(body.action).toBe('RELOGIN_AND_RETRY');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries the original request after a successful token refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'TOKEN_EXPIRED', error: 'token expired' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ success: true }, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ uploaded: true }, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSessionRefresh('/api/upload', { method: 'POST', body: 'raw' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.uploaded).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('forces a server refresh after token expiry even when the browser marker cookie is missing', async () => {
    vi.stubGlobal('document', { cookie: '' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 'TOKEN_EXPIRED', error: 'token expired' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ success: true }, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ uploaded: true }, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithSessionRefresh('/api/upload', { method: 'POST', body: 'raw' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.uploaded).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
