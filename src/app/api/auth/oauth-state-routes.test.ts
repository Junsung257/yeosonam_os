import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createOAuthState, verifyOAuthState, type OAuthStateProvider } from '@/lib/oauth-state';

vi.mock('@/lib/marketing-pipeline/token-resolver', () => ({
  saveOAuthToken: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { GET as startGoogle } from './google-oauth-start/route';
import { GET as startMeta } from './meta-oauth-start/route';
import { GET as startNaver } from './naver-oauth-start/route';
import { GET as startThreads } from './threads-oauth-start/route';
import { GET as callbackGoogle } from './google-callback/route';
import { GET as callbackMeta } from './meta-callback/route';
import { GET as callbackNaver } from './naver-callback/route';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function legacyDevState() {
  const payload = Buffer.from(JSON.stringify({ tenant_id: TENANT_ID, ts: Date.now() })).toString('base64url');
  const signature = createHmac('sha256', 'dev').update(payload).digest('hex').slice(0, 16);
  return `${payload}.${signature}`;
}

describe('OAuth route state configuration', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.yeosonam.com');
    vi.stubEnv('META_APP_ID', 'meta-app');
    vi.stubEnv('THREADS_APP_ID', 'threads-app');
    vi.stubEnv('GOOGLE_ADS_CLIENT_ID', 'google-client');
    vi.stubEnv('NAVER_CLIENT_ID', 'naver-client');
    vi.stubEnv('OAUTH_STATE_SECRET', '');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ['meta', startMeta, `?tenant_id=${TENANT_ID}`],
    ['google', startGoogle, `?tenant_id=${TENANT_ID}`],
    ['naver', startNaver, `?tenant_id=${TENANT_ID}`],
    ['threads', startThreads, ''],
  ] as const)('%s start fails closed instead of signing with a known key', async (_provider, handler, query) => {
    const response = await handler(new NextRequest(`https://www.yeosonam.com/api/auth/oauth-start${query}`));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).not.toHaveProperty('url');
  });

  it.each([
    ['meta', startMeta, `?tenant_id=${TENANT_ID}`],
    ['google', startGoogle, `?tenant_id=${TENANT_ID}`],
    ['naver', startNaver, `?tenant_id=${TENANT_ID}`],
    ['threads', startThreads, ''],
  ] as const)('%s start preserves a valid signed authorization flow', async (provider, handler, query) => {
    vi.stubEnv('OAUTH_STATE_SECRET', 'test-oauth-state-secret-with-at-least-32-characters');
    const response = await handler(new NextRequest(`https://www.yeosonam.com/api/auth/oauth-start${query}`));
    const body = await response.json() as { url: string };
    const state = new URL(body.url).searchParams.get('state');

    expect(response.status).toBe(200);
    expect(state).not.toBeNull();
    expect(verifyOAuthState(state!, provider as OAuthStateProvider)).toMatchObject({
      provider,
      tenant_id: provider === 'threads' ? 'threads' : TENANT_ID,
    });
  });

  it.each([
    ['meta', callbackMeta],
    ['google', callbackGoogle],
    ['naver', callbackNaver],
  ] as const)('%s callback rejects a state forged with the former dev key before token exchange', async (_provider, handler) => {
    const url = new URL(`https://www.yeosonam.com/api/auth/callback`);
    url.searchParams.set('code', 'attacker-code');
    url.searchParams.set('state', legacyDevState());

    const response = await handler(new NextRequest(url));

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the legitimate Google callback flow after state verification', async () => {
    vi.stubEnv('OAUTH_STATE_SECRET', 'test-oauth-state-secret-with-at-least-32-characters');
    vi.stubEnv('GOOGLE_ADS_CLIENT_SECRET', 'google-secret');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      access_token: 'provider-access-token',
      refresh_token: 'provider-refresh-token',
      expires_in: 3600,
      scope: 'scope-a scope-b',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const state = createOAuthState({ tenantId: TENANT_ID, provider: 'google' });
    const url = new URL('https://www.yeosonam.com/api/auth/google-callback');
    url.searchParams.set('code', 'legitimate-code');
    url.searchParams.set('state', state);

    const response = await callbackGoogle(new NextRequest(url));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('oauth=google_success');
    expect(saveOAuthToken).toHaveBeenCalledWith(TENANT_ID, 'google_ads', expect.objectContaining({
      accessToken: 'provider-access-token',
      refreshToken: 'provider-refresh-token',
    }));
  });
});
