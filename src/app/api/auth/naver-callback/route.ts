import { type NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { saveOAuthToken } from '@/lib/marketing-pipeline/token-resolver';
import { getSecret } from '@/lib/secret-registry';

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
    return NextResponse.redirect(
      new URL('/admin?oauth_error=naver_denied', request.url),
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

    await saveOAuthToken(tenantId, 'naver', {
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
