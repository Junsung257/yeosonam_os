import { type NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import { getSecret } from '@/lib/secret-registry';
import { consumeOAuthState, verifyOAuthState } from '@/lib/oauth-state';
import {
  isTenantPortalAuthError,
  requireTenantAdminRole,
  requireTenantPortalRequest,
} from '@/lib/tenant-portal-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const stateRaw = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    return NextResponse.redirect(
      new URL('/admin?oauth_error=naver_denied', request.url),
    );
  }

  if (!code || !stateRaw) {
    return apiResponse({ error: 'code or state is missing' }, { status: 400 });
  }

  const state = verifyOAuthState(stateRaw, 'naver');
  if (!state?.tenant_id) {
    return apiResponse({ error: 'state verification failed' }, { status: 400 });
  }

  const authorization = await requireTenantPortalRequest(request, state.tenant_id);
  if (isTenantPortalAuthError(authorization)) return authorization;
  const roleError = requireTenantAdminRole(authorization);
  if (roleError) return roleError;
  const consumedState = await consumeOAuthState(stateRaw, 'naver', Date.now(), authorization.userId);
  if (!consumedState?.tenant_id) {
    return apiResponse({ error: 'state verification failed' }, { status: 400 });
  }

  const clientId = getSecret('NAVER_CLIENT_ID');
  const clientSecret = getSecret('NAVER_CLIENT_SECRET');
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !clientSecret || !siteUrl) {
    return apiResponse({ error: 'Naver OAuth is not configured' }, { status: 500 });
  }

  try {
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
      console.error('[naver-callback] token exchange failed:', {
        status: tokenRes.status,
        detail: sanitizeDbError(detail, 'token exchange failed'),
      });
      return apiResponse({ error: 'token exchange failed' }, { status: 502 });
    }

    const tokenJson = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (tokenJson.error || !tokenJson.access_token) {
      console.error('[naver-callback] token response error:', {
        error: sanitizeDbError(tokenJson.error ?? 'missing_access_token', 'token exchange failed'),
        hasRefreshToken: Boolean(tokenJson.refresh_token),
        expiresIn: tokenJson.expires_in,
      });
      return apiResponse(
        { error: sanitizeDbError(tokenJson.error_description, 'token exchange failed') },
        { status: 502 },
      );
    }

    await saveOAuthToken(authorization.tenantId, 'naver', {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      expiresIn: tokenJson.expires_in ?? 3600,
      scopes: ['blog'],
    });
  } catch (err) {
    console.error('[naver-callback] callback failed:', sanitizeDbError(err, 'OAuth callback failed'));
    return apiResponse({ error: 'OAuth callback failed' }, { status: 500 });
  }

  return NextResponse.redirect(
    new URL('/admin?oauth=naver_success', request.url),
  );
}
