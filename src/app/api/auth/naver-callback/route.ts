import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import { getSecret } from '@/lib/secret-registry';

/**
 * 네이버 OAuth 콜백
 * GET /api/auth/naver-callback?code=&state=
 *
 * state에서 tenant_id 추출 → 네이버 토큰 교환 → encrypt → DB 저장
 *
 * 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, NEXT_PUBLIC_SITE_URL
 * 네이버 access_token TTL: 3600초 (1시간), refresh_token TTL: 없음(장기)
 */
export const dynamic = 'force-dynamic';

const STATE_TTL_MS = 10 * 60 * 1000; // 10분

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code      = searchParams.get('code');
  const stateRaw  = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/admin?oauth_error=${encodeURIComponent('naver_denied')}`, request.url),
    );
  }

  if (!code || !stateRaw) {
    return NextResponse.json({ error: 'code 또는 state 누락' }, { status: 400 });
  }

  // state 검증 (HMAC 서명 + TTL) — Google OAuth와 동일 패턴
  let tenantId: string;
  try {
    const dotIdx = stateRaw.lastIndexOf('.');
    if (dotIdx < 0) throw new Error('state 형식 오류');
    const payload  = stateRaw.slice(0, dotIdx);
    const sig      = stateRaw.slice(dotIdx + 1);
    const expected = createHmac('sha256', getSecret('OAUTH_STATE_SECRET') ?? 'dev').update(payload).digest('hex').slice(0, 16);
    const sigBuf   = Buffer.from(sig);
    const expBuf   = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new Error('state 서명 불일치');
    }
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      tenant_id: string;
      ts: number;
    };
    if (Date.now() - decoded.ts > STATE_TTL_MS) throw new Error('state 만료');
    tenantId = decoded.tenant_id;
  } catch {
    return NextResponse.json({ error: 'state 검증 실패' }, { status: 400 });
  }

  const clientId     = getSecret('NAVER_CLIENT_ID');
  const clientSecret = getSecret('NAVER_CLIENT_SECRET');
  const siteUrl      = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !clientSecret || !siteUrl) {
    return NextResponse.json({ error: 'Naver OAuth 환경변수 미설정' }, { status: 500 });
  }

  // 네이버 토큰 교환
  const tokenRes = await fetch('https://nid.naver.com/oauth2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      state: stateRaw,
      redirect_uri: `${siteUrl}/api/auth/naver-callback`,
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    console.error('[naver-callback] 토큰 교환 실패:', detail);
    return NextResponse.json({ error: '토큰 교환 실패' }, { status: 502 });
  }

  const tokenJson = await tokenRes.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (tokenJson.error || !tokenJson.access_token) {
    console.error('[naver-callback] 네이버 토큰 오류:', tokenJson);
    return NextResponse.json(
      { error: tokenJson.error_description ?? '토큰 교환 실패' },
      { status: 502 },
    );
  }

  // 기존 saveOAuthToken 재사용 (src/lib/marketing-pipeline/token-resolver.ts)
  await saveOAuthToken(tenantId, 'naver', {
    accessToken:  tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresIn:    tokenJson.expires_in ?? 3600,
    scopes:       ['blog'],
  });

  return NextResponse.redirect(
    new URL('/admin?oauth=naver_success', request.url),
  );
}
