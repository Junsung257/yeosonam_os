import { type NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import { OAuthStateConfigurationError, verifyOAuthState } from '@/lib/oauth-state';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const stateRaw = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    const allowed = new Set(['access_denied', 'invalid_scope', 'server_error', 'temporarily_unavailable']);
    const safeError = allowed.has(errorParam) ? errorParam : 'unknown_error';
    return NextResponse.redirect(
      new URL(`/admin?oauth_error=${encodeURIComponent(safeError)}`, request.url),
    );
  }

  if (!code || !stateRaw) {
    return apiResponse({ error: 'code or state is missing' }, { status: 400 });
  }

  let statePayload = null;
  try {
    statePayload = verifyOAuthState(stateRaw, 'google');
  } catch (error) {
    if (error instanceof OAuthStateConfigurationError) {
      return apiResponse({ error: 'OAuth state verification is not configured' }, { status: 503 });
    }
  }
  if (!statePayload) {
    return apiResponse({ error: 'state verification failed' }, { status: 400 });
  }
  const tenantId = statePayload.tenant_id;

  const clientId = getSecret('GOOGLE_ADS_CLIENT_ID');
  const clientSecret = getSecret('GOOGLE_ADS_CLIENT_SECRET');
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !clientSecret || !siteUrl) {
    return apiResponse({ error: 'Google OAuth is not configured' }, { status: 500 });
  }

  try {
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
      console.error('[google-callback] token exchange failed:', sanitizeDbError(detail, 'token exchange failed'));
      return apiResponse({ error: 'token exchange failed' }, { status: 502 });
    }

    const tokenJson = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    if (!tokenJson.access_token) {
      return apiResponse({ error: 'token exchange failed' }, { status: 502 });
    }

    await saveOAuthToken(tenantId, 'google_ads', {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      expiresIn: tokenJson.expires_in,
      scopes: tokenJson.scope?.split(' '),
    });
  } catch (err) {
    console.error('[google-callback] callback failed:', sanitizeDbError(err, 'OAuth callback failed'));
    return apiResponse({ error: 'OAuth callback failed' }, { status: 500 });
  }

  return NextResponse.redirect(
    new URL('/admin?oauth=google_success', request.url),
  );
}
