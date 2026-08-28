import { type NextRequest } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { apiResponse } from '@/lib/api-response';
import { createOAuthState, registerOAuthState } from '@/lib/oauth-state';
import {
  isTenantPortalAuthError,
  requireTenantAdminRole,
  requireTenantPortalRequest,
} from '@/lib/tenant-portal-auth';

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

  const authorization = await requireTenantPortalRequest(request, tenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;
  const roleError = requireTenantAdminRole(authorization);
  if (roleError) return roleError;

  const clientId = getSecret('GOOGLE_ADS_CLIENT_ID');
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !siteUrl) {
    return apiResponse(
      { error: 'GOOGLE_ADS_CLIENT_ID 또는 NEXT_PUBLIC_SITE_URL 미설정' },
      { status: 500 },
    );
  }

  let state: string;
  try {
    state = createOAuthState({ provider: 'google', tenantId: authorization.tenantId });
    await registerOAuthState({
      rawState: state,
      provider: 'google',
      tenantId: authorization.tenantId,
      actorUserId: authorization.userId,
    });
  } catch (error) {
    console.error('[google-oauth-start] state registration failed', error);
    return apiResponse({ error: 'OAuth state storage is unavailable' }, { status: 503 });
  }

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
  return apiResponse({ url }, { headers: { 'Cache-Control': 'private, no-store' } });
}
