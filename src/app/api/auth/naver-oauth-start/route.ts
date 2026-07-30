import { type NextRequest } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { apiResponse } from '@/lib/api-response';
import { createOAuthState, isOAuthStateConfigured } from '@/lib/oauth-state';

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
    return apiResponse({ error: 'tenant_id 필수 (UUID v4 형식)' }, { status: 400 });
  }

  const clientId = getSecret('NAVER_CLIENT_ID');
  const siteUrl  = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !siteUrl || !isOAuthStateConfigured()) {
    return apiResponse(
      { error: 'Naver OAuth is not configured' },
      { status: 503 },
    );
  }

  const state = createOAuthState({ tenantId, provider: 'naver' });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: `${siteUrl}/api/auth/naver-callback`,
    state,
  });

  const url = `https://nid.naver.com/oauth2.0/authorize?${params.toString()}`;
  return apiResponse({ url });
}
