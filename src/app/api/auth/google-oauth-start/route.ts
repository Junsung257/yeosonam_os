import { type NextRequest } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { apiResponse } from '@/lib/api-response';
import { createOAuthState, isOAuthStateConfigured } from '@/lib/oauth-state';

/**
 * Google Ads + Analytics OAuth 시작
 * GET /api/auth/google-oauth-start?tenant_id={uuid}
 * → { url: "https://accounts.google.com/..." }
 */
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  if (!tenantId || !UUID_RE.test(tenantId)) {
    return apiResponse({ error: 'tenant_id 필수 (UUID v4 형식)' }, { status: 400 });
  }

  const clientId = getSecret('GOOGLE_ADS_CLIENT_ID');
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !siteUrl || !isOAuthStateConfigured()) {
    return apiResponse(
      { error: 'Google OAuth is not configured' },
      { status: 503 },
    );
  }

  const state = createOAuthState({ tenantId, provider: 'google' });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${siteUrl}/api/auth/google-callback`,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/analytics.readonly',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return apiResponse({ url });
}
