import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import { getSecret } from '@/lib/secret-registry';

/**
 * Meta OAuth 콜백
 * GET /api/auth/meta-callback?code=&state=
 *
 * Short-lived 코드 → Short-lived token → Long-lived token (fb_exchange_token)
 */
export const dynamic = 'force-dynamic';

const STATE_TTL_MS = 10 * 60 * 1000;

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

  let tenantId: string;
  try {
    const dotIdx = stateRaw.lastIndexOf('.');
    if (dotIdx < 0) throw new Error('state 형식 오류');
    const payload = stateRaw.slice(0, dotIdx);
    const sig = stateRaw.slice(dotIdx + 1);
    const expected = createHmac('sha256', getSecret('OAUTH_STATE_SECRET') ?? 'dev').update(payload).digest('hex').slice(0, 16);
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) throw new Error('state 서명 불일치');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      tenant_id: string;
      ts: number;
    };
    if (Date.now() - decoded.ts > STATE_TTL_MS) throw new Error('state 만료');
    tenantId = decoded.tenant_id;
  } catch {
    return NextResponse.json({ error: 'state 검증 실패' }, { status: 400 });
  }

  const appId = getSecret('META_APP_ID');
  const appSecret = getSecret('META_APP_SECRET');
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
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
  const shortJson = await shortRes.json() as { access_token?: string; token_type?: string };
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
    ? await longRes.json() as { access_token: string; expires_in?: number }
    : null;

  const finalToken = longJson?.access_token ?? shortJson.access_token;
  const expiresIn = longJson?.expires_in;

  await saveOAuthToken(tenantId, 'meta', {
    accessToken: finalToken,
    expiresIn,
    scopes: ['ads_management', 'ads_read', 'read_insights'],
  });

  return NextResponse.redirect(new URL('/admin?oauth=meta_success', request.url));
}
