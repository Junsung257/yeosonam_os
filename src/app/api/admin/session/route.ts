/**
 * GET /api/admin/session
 *
 * 현재 로그인한 사용자의 역할 정보를 반환.
 * JWT 페이로드에서 app_metadata.role / user_role 등을 추출.
 *
 * 응답:
 *   {
 *     user: {
 *       id: string,
 *       email: string | null,
 *       role: 'platform_admin' | 'tenant_admin' | 'tenant_staff' | 'unknown',
 *       tenantId?: string,
 *     }
 *   }
 */
import { type NextRequest, type NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import { ADMIN_CACHE } from '@/lib/admin-cache';
import { inferTrustedAdminRole, inferTrustedTenantId } from '@/lib/admin-auth-claims';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type AdminRole = 'platform_admin' | 'tenant_admin' | 'tenant_staff' | 'unknown';

export interface AdminSessionUser {
  id: string;
  email: string | null;
  role: AdminRole;
  tenantId?: string;
}

const getHandler = async (req: NextRequest): Promise<NextResponse> => {
  if (process.env.NODE_ENV !== 'production' && req.cookies.get('ys-dev-admin')?.value === '1') {
    return apiResponse({
      user: {
        id: 'dev-admin',
        email: 'dev-admin@localhost',
        role: 'platform_admin',
      },
    }, { headers: ADMIN_CACHE.noCache });
  }

  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) {
    return apiResponse(
      { error: '세션 없음', user: null },
      { status: 401, headers: ADMIN_CACHE.noCache },
    );
  }

  const verified = await verifySupabaseAccessToken(token);
  if (!verified.ok || !verified.payload) {
    return apiResponse(
      { error: '토큰 검증 실패', user: null },
      { status: 401, headers: ADMIN_CACHE.noCache },
    );
  }

  const payload = verified.payload as Record<string, unknown>;
  const user: AdminSessionUser = {
    id: (typeof payload.sub === 'string' ? payload.sub : '') as string,
    email: typeof payload.email === 'string' ? payload.email : null,
    role: inferTrustedAdminRole(payload),
    tenantId: inferTrustedTenantId(payload),
  };

  return apiResponse({ user });
};

// 자신의 검증된 JWT claim만 반환하므로 platform-admin 전용 guard를 적용하지 않는다.
// tenant_admin/staff도 이 endpoint를 읽어야 UI와 API 권한 모델이 일치한다.
export const GET = getHandler;
