/**
 * lib/admin-guard.ts
 *
 * 어드민 전용 API 라우트에서 admin 세션을 확인하는 헬퍼.
 * middleware.ts 가 로그인 여부만 체크하므로,
 * 민감한 어드민 데이터를 반환하는 라우트는 이 함수로 추가 role 검증.
 *
 * 사용:
 *   if (!isAdminRequest(request)) {
 *     return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
 *   }
 */

import { type NextRequest } from 'next/server';

export function isAdminRequest(req: NextRequest): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);

  // 1) JWT payload email 기반 검증 (middleware에서 서명/만료 1차 확인 전제)
  const token = req.cookies.get('sb-access-token')?.value;
  if (token) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8')) as { email?: string; role?: string };
      const email = payload.email?.toLowerCase();
      if (payload.role === 'service_role') return true;
      if (email && adminEmails.includes(email)) return true;
    } catch {
      // noop
    }
  }

  // 2) 레거시 관리자 쿠키는 개발 모드에서만 허용
  const adminCookie = req.cookies.get('sb-admin')?.value;
  if (process.env.NODE_ENV !== 'production' && adminCookie) return true;

  // 3) 서버-to-서버 호출: service_role key Bearer 토큰
  const auth = req.headers.get('authorization') ?? '';
  if (
    auth.startsWith('Bearer ') &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    auth.slice(7) === process.env.SUPABASE_SERVICE_ROLE_KEY
  ) return true;

  return false;
}
