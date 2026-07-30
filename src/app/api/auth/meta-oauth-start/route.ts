import { type NextRequest } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { apiResponse } from '@/lib/api-response';
import { createOAuthState, isOAuthStateConfigured } from '@/lib/oauth-state';

/**
 * Meta (Instagram/Facebook Ads) OAuth 시작
 * GET /api/auth/meta-oauth-start?tenant_id={uuid}
 * → { url: "https://www.facebook.com/v18.0/dialog/oauth?..." }
 */
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  if (!tenantId || !UUID_RE.test(tenantId)) {
    return apiResponse({ error: 'tenant_id 필수 (UUID v4 형식)' }, { status: 400 });
  }

  const appId = getSecret('META_APP_ID');
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!appId || !siteUrl || !isOAuthStateConfigured()) {
    return apiResponse(
      { error: 'Meta OAuth is not configured' },
      { status: 503 },
    );
  }

  const state = createOAuthState({ tenantId, provider: 'meta' });

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: `${siteUrl}/api/auth/meta-callback`,
    scope: 'ads_management,ads_read,read_insights',
    state,
    response_type: 'code',
  });

  const url = `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  return apiResponse({ url });
}
