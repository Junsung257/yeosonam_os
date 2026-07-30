import { type NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import { invalidateMetaTokenCache } from '@/lib/meta-token-resolver';
import { OAuthStateConfigurationError, verifyOAuthState } from '@/lib/oauth-state';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin } from '@/lib/supabase';
import {
  exchangeThreadsAuthorizationCode,
  exchangeThreadsLongLivedToken,
  fetchThreadsTokenProfile,
} from '@/lib/threads-token';

export const dynamic = 'force-dynamic';

async function finishThreadsOAuth(input: {
  code: string;
  redirectUri: string;
  appId: string;
  appSecret: string;
}): Promise<{ userId: string; expiresAt?: string }> {
  const shortToken = await exchangeThreadsAuthorizationCode(input);
  const longToken = await exchangeThreadsLongLivedToken(
    shortToken.accessToken,
    input.appSecret,
  );
  const userId =
    longToken.userId ??
    shortToken.userId ??
    (await fetchThreadsTokenProfile(longToken.accessToken)).id;
  const now = new Date().toISOString();

  const tokenWrite = await supabaseAdmin.from('system_secrets').upsert({
    key: 'THREADS_ACCESS_TOKEN',
    value: longToken.accessToken,
    expires_at: longToken.expiresAt ?? null,
    updated_at: now,
  } as never, { onConflict: 'key' });
  if (tokenWrite.error) throw tokenWrite.error;

  const userWrite = await supabaseAdmin.from('system_secrets').upsert({
    key: 'THREADS_USER_ID',
    value: userId,
    updated_at: now,
  } as never, { onConflict: 'key' });
  if (userWrite.error) throw userWrite.error;

  const configWrite = await supabaseAdmin
    .from('social_platform_configs')
    .update({
      access_token: longToken.accessToken,
      token_expires_at: longToken.expiresAt ?? null,
      account_id: userId,
    } as never)
    .eq('platform', 'threads');
  if (configWrite.error) throw configWrite.error;

  invalidateMetaTokenCache('THREADS_ACCESS_TOKEN');
  invalidateMetaTokenCache('THREADS_USER_ID');
  return { userId, expiresAt: longToken.expiresAt };
}

async function finishMetaOAuth(input: {
  code: string;
  redirectUri: string;
  appId: string;
  appSecret: string;
  tenantId: string;
}): Promise<void> {
  const shortTokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  shortTokenUrl.searchParams.set('client_id', input.appId);
  shortTokenUrl.searchParams.set('client_secret', input.appSecret);
  shortTokenUrl.searchParams.set('redirect_uri', input.redirectUri);
  shortTokenUrl.searchParams.set('code', input.code);

  const shortResponse = await fetch(shortTokenUrl, {
    signal: AbortSignal.timeout(15_000),
  });
  const shortPayload = (await shortResponse.json().catch(() => null)) as {
    access_token?: string;
    user_id?: string;
  } | null;
  if (!shortResponse.ok || !shortPayload?.access_token) {
    throw new Error(`Meta token exchange failed (HTTP ${shortResponse.status})`);
  }

  const longTokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  longTokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longTokenUrl.searchParams.set('client_id', input.appId);
  longTokenUrl.searchParams.set('client_secret', input.appSecret);
  longTokenUrl.searchParams.set('fb_exchange_token', shortPayload.access_token);
  const longResponse = await fetch(longTokenUrl, {
    signal: AbortSignal.timeout(15_000),
  });
  const longPayload = longResponse.ok
    ? ((await longResponse.json().catch(() => null)) as {
        access_token?: string;
        expires_in?: number;
      } | null)
    : null;

  await saveOAuthToken(input.tenantId, 'meta', {
    accessToken: longPayload?.access_token ?? shortPayload.access_token,
    expiresIn: longPayload?.expires_in,
    scopes: ['ads_management', 'ads_read', 'read_insights'],
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const stateRaw = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    const allowed = new Set([
      'access_denied',
      'invalid_scope',
      'server_error',
      'temporarily_unavailable',
    ]);
    const safeError = allowed.has(errorParam) ? errorParam : 'unknown_error';
    return NextResponse.redirect(
      new URL(`/admin?oauth_error=${encodeURIComponent(safeError)}`, request.url),
    );
  }
  if (!code || !stateRaw) {
    return apiResponse({ error: 'code or state is missing' }, { status: 400 });
  }

  let state: ReturnType<typeof verifyOAuthState> | null = null;
  try {
    state = verifyOAuthState(stateRaw, ['meta', 'threads']);
  } catch (error) {
    if (error instanceof OAuthStateConfigurationError) {
      return apiResponse(
        { error: 'OAuth state verification is not configured' },
        { status: 503 },
      );
    }
  }
  if (!state) return apiResponse({ error: 'state verification failed' }, { status: 400 });

  const isThreads = state.provider === 'threads';
  const appId = isThreads
    ? getSecret('THREADS_APP_ID') || getSecret('META_APP_ID')
    : getSecret('META_APP_ID');
  const appSecret = isThreads
    ? getSecret('THREADS_APP_SECRET') || getSecret('META_APP_SECRET')
    : getSecret('META_APP_SECRET');
  const siteUrlRaw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    (isThreads ? 'https://www.yeosonam.com' : undefined);
  const siteUrl = siteUrlRaw?.replace(/\/+$/, '');
  if (!appId || !appSecret || !siteUrl) {
    return apiResponse({ error: 'Meta OAuth is not configured' }, { status: 503 });
  }

  const redirectUri = `${siteUrl}/api/auth/meta-callback`;
  try {
    if (isThreads) {
      await finishThreadsOAuth({ code, redirectUri, appId, appSecret });
      return NextResponse.redirect(new URL('/admin?oauth=threads_success', request.url));
    }
    await finishMetaOAuth({
      code,
      redirectUri,
      appId,
      appSecret,
      tenantId: state.tenant_id,
    });
    return NextResponse.redirect(new URL('/admin?oauth=meta_success', request.url));
  } catch (error) {
    console.error(
      `[meta-callback] ${isThreads ? 'Threads' : 'Meta'} OAuth failed:`,
      error instanceof Error ? error.message : 'unknown error',
    );
    return apiResponse({ error: 'OAuth token exchange failed' }, { status: 502 });
  }
}
