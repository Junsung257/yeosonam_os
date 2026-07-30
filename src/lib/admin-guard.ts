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
import { inferTrustedAdminRole } from '@/lib/admin-auth-claims';

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
  const role = inferTrustedAdminRole(v.payload as Record<string, unknown>);
  return {
    authorized: role === 'platform_admin' || !!(email && adminEmails.includes(email)),
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
