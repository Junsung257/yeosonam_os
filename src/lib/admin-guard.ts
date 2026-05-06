/**
 * 어드민 전용 API 라우트에서 세션을 확인하는 헬퍼.
 *
 * - Supabase access_token 은 SUPABASE_JWT_SECRET 으로 서명 검증 후 이메일 화이트리스트(ADMIN_EMAILS) 확인.
 * - 서버 간 호출: Authorization Bearer 가 SUPABASE_SERVICE_ROLE_KEY 와 일치할 때만 허용.
 * - 레거시 sb-admin 쿠키는 비프로덕션에서만.
 */

import { type NextRequest } from 'next/server';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import { getSecret } from '@/lib/secret-registry';

export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  const serviceRole = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ') && serviceRole && auth.slice(7) === serviceRole) {
    return true;
  }

  if (process.env.NODE_ENV !== 'production' && req.cookies.get('sb-admin')?.value) {
    return true;
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length === 0) return false;

  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) return false;

  const v = await verifySupabaseAccessToken(token);
  if (!v.ok) return false;

  const email =
    typeof v.payload.email === 'string' ? v.payload.email.toLowerCase() : undefined;
  return !!(email && adminEmails.includes(email));
}

/** 정책 감사 로그용: 검증된 이메일 또는 service / 기본값 */
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
