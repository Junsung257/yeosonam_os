/**
 * 어드민 전용 API 라우트에서 세션을 확인하는 헬퍼.
 *
 * - Supabase access_token 은 SUPABASE_JWT_SECRET 으로 서명 검증 후 이메일 화이트리스트(ADMIN_EMAILS) 확인.
 * - 서버 간 호출: Authorization Bearer 가 SUPABASE_SERVICE_ROLE_KEY 와 일치할 때만 허용.
 * - 비프로덕션 dev 우회: ys-dev-admin=1 (middleware 와 동일 쿠키) 또는 레거시 sb-admin.
 *
 * 사용:
 *   export const GET = withAdminGuard(async (req) => {
 *     const { data } = await supabaseAdmin.from('table').select('*');
 *     return NextResponse.json({ data });
 *   });
 */

import { type NextRequest, NextResponse } from 'next/server';
import { verifySupabaseAccessToken, legacyJwtExpValid } from '@/lib/supabase-jwt-verify';
import { getSecret } from '@/lib/secret-registry';

/** verify 라우트가 64s+ 걸리는 업로드 직후 호출되는 경우 access_token 이 만료된 채 도착할 수 있다.
 *  client(fetchWithSessionRefresh)는 `error === 'token expired'` 일 때만 refresh+retry 하므로
 *  admin guard 가 만료를 구분해 알려준다. */
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
    // 2026-05-15 박제: dev 환경 매우 관대 모드 — sb-access-token 쿠키만 있으면 통과.
    //   verifySupabaseAccessToken 이 .env.local SUPABASE_JWT_SECRET 미설정·만료된 토큰 등
    //   환경 문제로 false 떨어져 verify 401 race 가 끊임없이 발생하던 사고 차단.
    //   production 은 그대로 엄격 (아래 JWT verify 분기 사용).
    if (req.cookies.get('sb-access-token')?.value) return true;
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);

  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) return false;

  const v = await verifySupabaseAccessToken(token);
  if (!v.ok) return false;

  // dev 환경에서 ADMIN_EMAILS 미설정이면 verify 성공만으로 통과 (2026-05-14 박제).
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
  // 만료 토큰은 client refresh+retry 가능 신호로 응답 (middleware 와 동일 컨벤션)
  if (isAccessTokenExpired(req)) {
    return NextResponse.json(
      { code: 'TOKEN_EXPIRED', error: 'token expired' },
      { status: 401 },
    );
  }
  return NextResponse.json(
    { code: 'UNAUTHORIZED', error: '관리자 권한이 필요합니다.' },
    { status: 401 }
  );
}

type NextHandler = (req: NextRequest, ctx?: any) => Promise<NextResponse>;

export function withAdminGuard(handler: NextHandler): NextHandler {
  return async (req: NextRequest, ctx?: any): Promise<NextResponse> => {
    const authError = await requireAdminRequest(req);
    if (authError) return authError;
    return ctx ? handler(req, ctx) : handler(req);
  };
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
