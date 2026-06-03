/**
 * Admin API guard.
 *
 * - Browser admin calls use a Supabase access token verified against ADMIN_EMAILS.
 * - Server-to-server calls may use the Supabase service-role bearer token.
 * - Non-production keeps the existing dev bypass cookies.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { verifySupabaseAccessToken, legacyJwtExpValid } from '@/lib/supabase-jwt-verify';
import { getSecret } from '@/lib/secret-registry';

function isAccessTokenExpired(req: NextRequest): boolean {
  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) return false;
  return !legacyJwtExpValid(token);
}

export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  const serviceRole = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ') && serviceRole && auth.slice(7) === serviceRole) {
    return true;
  }

  if (process.env.NODE_ENV !== 'production') {
    if (req.cookies.get('ys-dev-admin')?.value === '1') return true;
    if (req.cookies.get('sb-admin')?.value) return true;
    if (req.cookies.get('sb-access-token')?.value) return true;
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) return false;

  const v = await verifySupabaseAccessToken(token);
  if (!v.ok) return false;

  if (adminEmails.length === 0) {
    return process.env.NODE_ENV !== 'production';
  }

  const email =
    typeof v.payload.email === 'string' ? v.payload.email.toLowerCase() : undefined;
  return !!(email && adminEmails.includes(email));
}

export async function requireAdminRequest(req: NextRequest): Promise<NextResponse | null> {
  const isAdmin = await isAdminRequest(req);
  if (isAdmin) return null;

  if (isAccessTokenExpired(req)) {
    const response = apiResponse(
      { code: 'TOKEN_EXPIRED', error: 'token expired' },
      { status: 401 },
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const response = apiResponse(
    { code: 'UNAUTHORIZED', error: '관리자 권한이 필요합니다.' },
    { status: 401 },
  );
  response.headers.set('Cache-Control', 'no-store');
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
  const serviceRole = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ') && serviceRole && auth.slice(7) === serviceRole) {
    return 'service_role';
  }

  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) return 'admin';

  const v = await verifySupabaseAccessToken(token);
  if (!v.ok) return 'admin';

  if (typeof v.payload.email === 'string' && v.payload.email) return v.payload.email;
  if (typeof v.payload.sub === 'string' && v.payload.sub) return v.payload.sub;
  return 'admin';
}
