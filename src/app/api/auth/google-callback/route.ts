import { type NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';

export const dynamic = 'force-dynamic';

const STATE_TTL_MS = 10 * 60 * 1000;

function verifyState(stateRaw: string): string | null {
  const dotIdx = stateRaw.lastIndexOf('.');
  if (dotIdx < 0) return null;

  const payload = stateRaw.slice(0, dotIdx);
  const sig = stateRaw.slice(dotIdx + 1);
  const expected = createHmac('sha256', getSecret('OAUTH_STATE_SECRET') ?? 'dev')
    .update(payload)
    .digest('hex')
    .slice(0, 16);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    tenant_id?: string;
    ts?: number;
  };
  if (!decoded.tenant_id || typeof decoded.ts !== 'number') return null;
  if (Date.now() - decoded.ts > STATE_TTL_MS) return null;
  return decoded.tenant_id;
}

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

  let tenantId: string | null = null;
  try {
    tenantId = verifyState(stateRaw);
  } catch {
    tenantId = null;
  }
  if (!tenantId) {
    return apiResponse({ error: 'state verification failed' }, { status: 400 });
  }

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
