import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exchangeThreadsAuthorizationCode,
  exchangeThreadsLongLivedToken,
  refreshThreadsLongLivedToken,
} from './threads-token';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Threads token lifecycle', () => {
  it('uses the Threads code exchange endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'short', user_id: '123' }), {
        status: 200,
      }),
    );

    const result = await exchangeThreadsAuthorizationCode({
      code: 'code',
      redirectUri: 'https://www.yeosonam.com/api/auth/meta-callback',
      appId: 'app',
      appSecret: 'secret',
    });

    expect(result).toMatchObject({ accessToken: 'short', userId: '123' });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://graph.threads.net/oauth/access_token',
    );
  });

  it('exchanges and refreshes long-lived tokens through graph.threads.net', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'long', expires_in: 5_184_000 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'renewed', expires_in: 5_184_000 }), {
          status: 200,
        }),
      );

    await exchangeThreadsLongLivedToken('short', 'app-secret');
    await refreshThreadsLongLivedToken('long');

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'https://graph.threads.net/access_token?grant_type=th_exchange_token',
    );
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token',
    );
    expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer long',
    );
  });
});
