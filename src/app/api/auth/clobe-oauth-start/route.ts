import { type NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import {
  buildClobeAuthorizationUrl,
  buildClobeRedirectUri,
  createPkcePair,
  discoverClobeOAuthMetadata,
  getClobeMcpUrl,
  getClobeSiteUrl,
  registerClobeOAuthClient,
  sealClobeOAuthState,
} from '@/lib/clobe-oauth';
import { registerOpaqueOAuthState } from '@/lib/oauth-state';
import {
  isTenantPortalAuthError,
  requireTenantAdminRole,
  requireTenantPortalRequest,
} from '@/lib/tenant-portal-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestedTenantId = request.nextUrl.searchParams.get('tenant_id') ?? '';
  const authorization = await requireTenantPortalRequest(request, requestedTenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;
  const roleError = requireTenantAdminRole(authorization);
  if (roleError) return roleError;

  if (!authorization.tenantId) {
    return apiResponse({ error: 'tenant_id is required' }, { status: 400 });
  }

  const siteUrl = getClobeSiteUrl();
  if (!siteUrl) {
    return apiResponse({ error: 'NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_BASE_URL is required' }, { status: 500 });
  }

  try {
    const metadata = await discoverClobeOAuthMetadata();
    const redirectUri = buildClobeRedirectUri(siteUrl);
    const registration = await registerClobeOAuthClient(metadata, redirectUri);
    const pkce = createPkcePair();
    const state = sealClobeOAuthState({
      tenant_id: authorization.tenantId,
      client_id: registration.client_id,
      code_verifier: pkce.codeVerifier,
      token_endpoint: metadata.token_endpoint,
      resource: getClobeMcpUrl(),
      ts: Date.now(),
    });
    await registerOpaqueOAuthState({
      rawState: state,
      provider: 'clobe',
      tenantId: authorization.tenantId,
      actorUserId: authorization.userId,
    });
    const url = buildClobeAuthorizationUrl({
      metadata,
      clientId: registration.client_id,
      redirectUri,
      state,
      codeChallenge: pkce.codeChallenge,
    });

    if (request.nextUrl.searchParams.get('json') === '1') {
      return apiResponse({ url }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    return NextResponse.redirect(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Clobe OAuth start failed';
    return apiResponse({ error: message }, { status: 502 });
  }
}
