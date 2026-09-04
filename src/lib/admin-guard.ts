/**
 * Admin API guard.
 *
 * - Browser admin calls use a Supabase access token verified against ADMIN_EMAILS.
 * - Server-to-server calls may use ADMIN_API_TOKEN via x-admin-token.
 * - Non-production keeps the existing dev bypass cookies.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isValidAdminApiToken } from '@/lib/api-auth';
import { verifySupabaseAccessToken, legacyJwtExpValid } from '@/lib/supabase-jwt-verify';

type AdminAuthorization = {
  authorized: boolean;
  authenticated: boolean;
  expired: boolean;
};

async function resolveAdminAuthorization(req: NextRequest): Promise<AdminAuthorization> {
  if (isValidAdminApiToken(req)) {
    return { authorized: true, authenticated: true, expired: false };
  }

  if (process.env.NODE_ENV !== 'production') {
    if (req.cookies.get('ys-dev-admin')?.value === '1') {
      return { authorized: true, authenticated: true, expired: false };
    }
    if (req.cookies.get('sb-admin')?.value) {
      return { authorized: true, authenticated: true, expired: false };
    }
    if (req.cookies.get('sb-access-token')?.value) {
      return { authorized: true, authenticated: true, expired: false };
    }
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) {
    return { authorized: false, authenticated: false, expired: false };
  }

  if (!legacyJwtExpValid(token)) {
    return { authorized: false, authenticated: false, expired: true };
  }

  const v = await verifySupabaseAccessToken(token);
  if (!v.ok) {
    return { authorized: false, authenticated: false, expired: false };
  }

  if (adminEmails.length === 0) {
    return {
      authorized: process.env.NODE_ENV !== 'production',
      authenticated: true,
      expired: false,
    };
  }

  const email =
    typeof v.payload.email === 'string' ? v.payload.email.toLowerCase() : undefined;
  return {
    authorized: !!(email && adminEmails.includes(email)),
    authenticated: true,
    expired: false,
  };
}

export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  return (await resolveAdminAuthorization(req)).authorized;
}

export async function requireAdminRequest(req: NextRequest): Promise<NextResponse | null> {
  const authorization = await resolveAdminAuthorization(req);
  if (authorization.authorized) return null;

  if (authorization.expired) {
    const response = apiResponse(
      { code: 'TOKEN_EXPIRED', error: 'token expired' },
      { status: 401 },
    );
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  if (authorization.authenticated) {
    const response = apiResponse(
      { code: 'FORBIDDEN', error: '관리자 권한이 필요합니다.' },
      { status: 403 },
    );
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  const response = apiResponse(
    { code: 'UNAUTHORIZED', error: '관리자 권한이 필요합니다.' },
    { status: 401 },
  );
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

type NextHandler = (req: NextRequest, ctx?: any) => Promise<NextResponse>;

export function withAdminGuard(handler: NextHandler): NextHandler {
  return async (req: NextRequest, ctx?: any): Promise<NextResponse> => {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;
    return ctx ? handler(req, ctx) : handler(req);
  };
}

/**
 * Platform-only read surfaces must not fall back to tenant-admin access.
 * The browser role is accepted only from verified JWT claims (app_metadata or
 * the top-level role claim); user_metadata is intentionally not trusted for
 * authorization. Server-to-server ADMIN_API_TOKEN remains available for the
 * read-only internal control surface.
 *
 * `ADMIN_EMAILS` predates the role claim rollout and is still the production
 * browser-admin boundary for the rest of the admin surface. During that
 * migration, a single explicitly allowlisted owner email may also open the
 * read-only Office when the JWT carries no role claim at all. An explicit
 * tenant/unknown role never receives this fallback, and a multi-address
 * `ADMIN_EMAILS` list must opt into the narrower `PLATFORM_ADMIN_EMAILS`
 * variable instead.
 */
export async function requirePlatformAdminRequest(req: NextRequest): Promise<NextResponse | null> {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  if (isValidAdminApiToken(req) || process.env.NODE_ENV !== 'production') {
    return null;
  }

  const token = req.cookies.get('sb-access-token')?.value;
  if (!token || !legacyJwtExpValid(token)) {
    return apiResponse(
      { code: 'PLATFORM_ADMIN_REQUIRED', error: '플랫폼 관리자 권한이 필요합니다.' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  const verified = await verifySupabaseAccessToken(token);
  const payload = verified.ok ? verified.payload as Record<string, unknown> : null;
  const appMetadata = payload?.app_metadata as Record<string, unknown> | undefined;
  const rawRole = typeof appMetadata?.role === 'string'
    ? appMetadata.role
    : typeof payload?.role === 'string' ? payload.role : '';
  const role = rawRole.toLowerCase();
  if (
    role === 'platform_admin'
    || role === 'platform'
    || role === 'admin'
    || role === 'super_admin'
  ) return null;

  // Legacy production sessions can be valid admin sessions without a custom
  // role claim. Keep the compatibility path deliberately narrow: only an
  // exact match against PLATFORM_ADMIN_EMAILS is preferred; when that variable
  // is absent, a single-address ADMIN_EMAILS allowlist is treated as the owner
  // boundary. Never upgrade an explicit non-platform role.
  if (!role) {
    const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const platformEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const legacyEmails = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const allowedLegacyOwner = platformEmails.length === 0
      && legacyEmails.length === 1
      && email === legacyEmails[0];
    if (email && (platformEmails.includes(email) || allowedLegacyOwner)) return null;
  }

  return apiResponse(
    { code: 'PLATFORM_ADMIN_REQUIRED', error: '플랫폼 관리자 권한이 필요합니다.' },
    { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function resolveAdminActorLabel(req: NextRequest): Promise<string> {
  if (isValidAdminApiToken(req)) {
    return 'admin_api_token';
  }

  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) return 'admin';

  const v = await verifySupabaseAccessToken(token);
  if (!v.ok) return 'admin';

  if (typeof v.payload.email === 'string' && v.payload.email) return v.payload.email;
  if (typeof v.payload.sub === 'string' && v.payload.sub) return v.payload.sub;
  return 'admin';
}

/** Returns the authenticated Supabase user id for actions that legally or
 * commercially require one accountable human. An API token or dev cookie is
 * sufficient for ordinary admin automation, but deliberately not for an
 * evidence-selection exception. */
export async function resolveAdminActorId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get('sb-access-token')?.value;
  if (!token || !legacyJwtExpValid(token)) return null;
  const verified = await verifySupabaseAccessToken(token);
  if (!verified.ok) return null;
  const subject = typeof verified.payload.sub === 'string' ? verified.payload.sub : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(subject)
    ? subject
    : null;
}

/**
 * Interactive OAuth must be started by a real Supabase admin session.
 * Shared API tokens and development bypass cookies are intentionally rejected
 * because they cannot be bound to one accountable human actor.
 */
export async function requireHumanAdminActor(req: NextRequest): Promise<NextResponse | null> {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  if (isValidAdminApiToken(req) || !(await resolveAdminActorId(req))) {
    const response = apiResponse(
      { code: 'INTERACTIVE_ADMIN_SESSION_REQUIRED', error: 'OAuth 연결은 관리자 사용자 세션에서 시작해야 합니다.' },
      { status: 403 },
    );
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  return null;
}
