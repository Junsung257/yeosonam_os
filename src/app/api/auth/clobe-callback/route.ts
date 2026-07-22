import { type NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import {
  buildClobeRedirectUri,
  exchangeClobeAuthorizationCode,
  getClobeSiteUrl,
  unsealClobeOAuthState,
} from '@/lib/clobe-oauth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const stateRaw = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    const safeError = encodeURIComponent(errorParam.slice(0, 80));
    return NextResponse.redirect(new URL(`/admin/settings/integrations?oauth_error=clobe_${safeError}`, request.url));
  }

  if (!code || !stateRaw) {
    return apiResponse({ error: 'code or state is missing' }, { status: 400 });
  }

  const state = unsealClobeOAuthState(stateRaw);
  if (!state) {
    return apiResponse({ error: 'state verification failed' }, { status: 400 });
  }

  const siteUrl = getClobeSiteUrl();
  if (!siteUrl) {
    return apiResponse({ error: 'NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_BASE_URL is required' }, { status: 500 });
  }

  try {
    const redirectUri = buildClobeRedirectUri(siteUrl);
    const tokenJson = await exchangeClobeAuthorizationCode({
      tokenEndpoint: state.token_endpoint,
      clientId: state.client_id,
      code,
      codeVerifier: state.code_verifier,
      redirectUri,
      resource: state.resource,
    });

    await saveOAuthToken(state.tenant_id, 'clobe', {
      accessToken: tokenJson.access_token!,
      refreshToken: tokenJson.refresh_token,
      expiresIn: tokenJson.expires_in,
      scopes: tokenJson.scope?.split(/\s+/).filter(Boolean) ?? ['mcp'],
      metadata: {
        client_id: state.client_id,
        token_endpoint: state.token_endpoint,
        resource: state.resource,
        connected_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[clobe-callback] callback failed:', sanitizeDbError(error, 'Clobe OAuth callback failed'));
    return apiResponse({ error: 'Clobe OAuth callback failed' }, { status: 502 });
  }

  return NextResponse.redirect(new URL('/admin/settings/integrations?oauth=clobe_success', request.url));
}
