import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { getSecret } from '@/lib/secret-registry';

/**
 * 네이버 OAuth 시작 (블로그 API 연동)
 * GET /api/auth/naver-oauth-start?tenant_id={uuid}
 * → { url: "https://nid.naver.com/oauth2.0/authorize?..." }
 *
 * 환경변수: NAVER_CLIENT_ID, NEXT_PUBLIC_SITE_URL, OAUTH_STATE_SECRET
 */
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  if (!tenantId || !UUID_RE.test(tenantId)) {
    return NextResponse.json({ error: 'tenant_id 필수 (UUID v4 형식)' }, { status: 400 });
  }

  const clientId = getSecret('NAVER_CLIENT_ID');
  const siteUrl  = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !siteUrl) {
    return NextResponse.json(
      { error: 'NAVER_CLIENT_ID 또는 NEXT_PUBLIC_SITE_URL 미설정' },
      { status: 500 },
    );
  }

  // CSRF 방어용 HMAC-signed state (10분 유효) — Google OAuth와 동일 패턴
  const stateSecret = getSecret('OAUTH_STATE_SECRET');
  if (!stateSecret) {
    console.warn('[naver-oauth-start] OAUTH_STATE_SECRET 미설정 — CSRF 보호 비활성화 상태');
  }
  const payload = Buffer.from(JSON.stringify({ tenant_id: tenantId, ts: Date.now() })).toString('base64url');
  const sig     = createHmac('sha256', stateSecret ?? 'dev').update(payload).digest('hex').slice(0, 16);
  const state   = `${payload}.${sig}`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `${siteUrl}/api/auth/naver-callback`,
    state,
  });

  const url = `https://nid.naver.com/oauth2.0/authorize?${params.toString()}`;
  return NextResponse.json({ url });
}
