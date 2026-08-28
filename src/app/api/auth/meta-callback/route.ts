import { NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin } from '@/lib/supabase';
import { consumeOAuthState, verifyOAuthState } from '@/lib/oauth-state';
import { requireAdminRequest, resolveAdminActorId } from '@/lib/admin-guard';
import {
  isTenantPortalAuthError,
  requireTenantAdminRole,
  requireTenantPortalRequest,
} from '@/lib/tenant-portal-auth';

/**
 * Meta OAuth 콜백
 * GET /api/auth/meta-callback?code=&state=
 *
 * Short-lived 코드 → Short-lived token → Long-lived token (fb_exchange_token)
 *
 * state.payload 에 platform 이 있으면 Threads 전용 OAuth 로 처리.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const stateRaw = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    const ALLOWED = new Set(['access_denied', 'invalid_scope', 'server_error', 'temporarily_unavailable']);
    const safeError = ALLOWED.has(errorParam) ? errorParam : 'unknown_error';
    return NextResponse.redirect(
      new URL(`/admin?oauth_error=${encodeURIComponent(safeError)}`, request.url),
    );
  }

  if (!code || !stateRaw) {
    return NextResponse.json({ error: 'code 또는 state 누락' }, { status: 400 });
  }

  const payload = verifyOAuthState(stateRaw, 'meta')
    ?? verifyOAuthState(stateRaw, 'threads');
  if (!payload) {
    return NextResponse.json({ error: 'state 검증 실패' }, { status: 400 });
  }

  const isThreadsOAuth = payload.provider === 'threads';
  let actorUserId: string | null | undefined;
  let authorizedTenantId: string | undefined;
  if (isThreadsOAuth && payload.scope !== 'platform') {
    return apiResponse({ error: 'state scope mismatch' }, { status: 400 });
  }
  if (!isThreadsOAuth && (payload.scope !== 'tenant' || !payload.tenant_id)) {
    return apiResponse({ error: 'state scope mismatch' }, { status: 400 });
  }
  if (isThreadsOAuth) {
    const authError = await requireAdminRequest(request);
    if (authError) return authError;
    actorUserId = await resolveAdminActorId(request);
    if (!actorUserId) {
      return apiResponse(
        { code: 'INTERACTIVE_ADMIN_SESSION_REQUIRED', error: 'OAuth 연결은 관리자 사용자 세션에서 시작해야 합니다.' },
        { status: 403 },
      );
    }
  } else {
    const authorization = await requireTenantPortalRequest(request, payload.tenant_id!);
    if (isTenantPortalAuthError(authorization)) return authorization;
    const roleError = requireTenantAdminRole(authorization);
    if (roleError) return roleError;
    actorUserId = authorization.userId;
    authorizedTenantId = authorization.tenantId;
  }
  const consumedPayload = await consumeOAuthState(
    stateRaw,
    payload.provider,
    Date.now(),
    actorUserId,
  );
  if (!consumedPayload) {
    return NextResponse.json({ error: 'state 검증 실패' }, { status: 400 });
  }
  const appId = isThreadsOAuth
    ? getSecret('THREADS_APP_ID') || getSecret('META_APP_ID')
    : getSecret('META_APP_ID');
  const appSecret = isThreadsOAuth
    ? getSecret('THREADS_APP_SECRET') || getSecret('META_APP_SECRET')
    : getSecret('META_APP_SECRET');
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (isThreadsOAuth ? 'https://www.yeosonam.com' : undefined);
  if (!appId || !appSecret || !siteUrl) {
    return NextResponse.json({ error: 'Meta OAuth 환경변수 미설정' }, { status: 500 });
  }

  // 1단계: code → short-lived token
  const shortTokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  shortTokenUrl.searchParams.set('client_id', appId);
  shortTokenUrl.searchParams.set('client_secret', appSecret);
  shortTokenUrl.searchParams.set('redirect_uri', `${siteUrl}/api/auth/meta-callback`);
  shortTokenUrl.searchParams.set('code', code);

  const shortRes = await fetch(shortTokenUrl.toString());
  if (!shortRes.ok) {
    const detail = await shortRes.text();
    console.error('[meta-callback] short-lived 토큰 교환 실패:', detail);
    return NextResponse.json({ error: '토큰 교환 실패' }, { status: 502 });
  }
  const shortJson = (await shortRes.json()) as { access_token?: string; token_type?: string; user_id?: string };
  if (!shortJson.access_token) {
    return NextResponse.json({ error: '토큰 교환 실패: access_token 없음' }, { status: 502 });
  }

  // 2단계: short-lived → long-lived token (60일 유효)
  const longTokenUrl = new URL('https://graph.facebook.com/v18.0/oauth/access_token');
  longTokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longTokenUrl.searchParams.set('client_id', appId);
  longTokenUrl.searchParams.set('client_secret', appSecret);
  longTokenUrl.searchParams.set('fb_exchange_token', shortJson.access_token);

  const longRes = await fetch(longTokenUrl.toString());
  if (!longRes.ok) {
    console.warn('[meta-callback] long-lived 토큰 교환 실패 (HTTP', longRes.status, ') — short-lived 토큰으로 대체');
  }
  const longJson = longRes.ok
    ? ((await longRes.json()) as { access_token: string; user_id?: string; expires_in?: number })
    : null;

  const finalToken = longJson?.access_token ?? shortJson.access_token;
  const metaUserId = longJson?.user_id ?? shortJson?.user_id;
  const expiresIn = longJson?.expires_in;

  if (payload.provider === 'threads') {
    // Threads 전용: 토큰을 DB system_secrets 에 저장
    const upsertData: Record<string, unknown> = {
      key: 'THREADS_ACCESS_TOKEN',
      value: finalToken,
      updated_at: new Date().toISOString(),
    };
    await supabaseAdmin.from('system_secrets').upsert(upsertData, { onConflict: 'key' });

    // threads_user_id 도 있으면 저장
    if (metaUserId) {
      await supabaseAdmin.from('system_secrets').upsert(
        { key: 'THREADS_USER_ID', value: metaUserId, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      );
    }

    return NextResponse.redirect(new URL('/admin?oauth=threads_success', request.url));
  }

  await saveOAuthToken(authorizedTenantId!, 'meta', {
    accessToken: finalToken,
    expiresIn,
    scopes: ['ads_management', 'ads_read', 'read_insights'],
    metadata: metaUserId ? { meta_user_id: metaUserId } : {},
  });

  return NextResponse.redirect(new URL('/admin?oauth=meta_success', request.url));
}
