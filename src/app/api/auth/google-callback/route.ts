import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getSecret } from '@/lib/secret-registry';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';

/**
 * Google OAuth 콜백
 * GET /api/auth/google-callback?code=&state=
 *
 * state에서 tenant_id 추출 → Google 토큰 교환 → encrypt → DB 저장
 */
export const dynamic = 'force-dynamic';

const STATE_TTL_MS = 10 * 60 * 1000; // 10분

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

  // state 검증 (HMAC 서명 + TTL)
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

  const clientId = getSecret('GOOGLE_ADS_CLIENT_ID');
  const clientSecret = getSecret('GOOGLE_ADS_CLIENT_SECRET');
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !clientSecret || !siteUrl) {
    return NextResponse.json({ error: 'Google OAuth 환경변수 미설정' }, { status: 500 });
  }

  // 토큰 교환
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${siteUrl}/api/auth/google-callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    console.error('[google-callback] 토큰 교환 실패:', detail);
    return NextResponse.json({ error: '토큰 교환 실패' }, { status: 502 });
  }

  const tokenJson = await tokenRes.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  if (!tokenJson.access_token) {
    return NextResponse.json({ error: '토큰 교환 실패: access_token 없음' }, { status: 502 });
  }

  await saveOAuthToken(tenantId, 'google_ads', {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresIn: tokenJson.expires_in,
    scopes: tokenJson.scope?.split(' '),
  });

  return NextResponse.redirect(
    new URL(`/admin?oauth=google_success`, request.url),
  );
}
