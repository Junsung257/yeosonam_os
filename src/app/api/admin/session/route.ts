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
import { withAdminGuard } from '@/lib/admin-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type AdminRole = 'platform_admin' | 'tenant_admin' | 'tenant_staff' | 'unknown';

export interface AdminSessionUser {
  id: string;
  email: string | null;
  role: AdminRole;
  tenantId?: string;
}

function inferRoleFromPayload(payload: Record<string, unknown>): AdminRole {
  // 1) app_metadata.role (Supabase custom claims에 가장 흔함)
  const appMeta = payload.app_metadata as Record<string, unknown> | undefined;
  if (appMeta) {
    const role = appMeta.role;
    if (typeof role === 'string') {
      const normalized = role.toLowerCase();
      if (normalized === 'platform_admin' || normalized === 'platform' || normalized === 'admin') return 'platform_admin';
      if (normalized === 'tenant_admin') return 'tenant_admin';
      if (normalized === 'tenant_staff' || normalized === 'staff') return 'tenant_staff';
    }
  }

  // 2) user_metadata.role
  const userMeta = payload.user_metadata as Record<string, unknown> | undefined;
  if (userMeta) {
    const role = userMeta.role;
    if (typeof role === 'string') {
      const normalized = role.toLowerCase();
      if (normalized === 'platform_admin') return 'platform_admin';
      if (normalized === 'tenant_admin') return 'tenant_admin';
      if (normalized === 'tenant_staff') return 'tenant_staff';
    }
  }

  // 3) JWT 커스텀 claim: https://supabase.com/schemas/auth/role
  if (typeof payload.role === 'string') {
    const role = (payload.role as string).toLowerCase();
    if (['platform_admin', 'tenant_admin', 'tenant_staff'].includes(role)) {
      return role as AdminRole;
    }
  }

  // Legacy owner sessions predate the role claim rollout. Keep the menu
  // projection aligned with requirePlatformAdminRequest without upgrading an
  // explicit tenant role: only an exact PLATFORM_ADMIN_EMAILS match is
  // accepted, or the single-address ADMIN_EMAILS owner boundary.
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const platformEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const legacyEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    email &&
    (platformEmails.includes(email) || (platformEmails.length === 0 && legacyEmails.length === 1 && legacyEmails[0] === email))
  ) {
    return 'platform_admin';
  }

  return 'unknown';
}

function inferTenantId(payload: Record<string, unknown>): string | undefined {
  // app_metadata.tenant_id 또는 tenantId
  const appMeta = payload.app_metadata as Record<string, unknown> | undefined;
  if (appMeta?.tenant_id && typeof appMeta.tenant_id === 'string') return appMeta.tenant_id;
  if (appMeta?.tenantId && typeof appMeta.tenantId === 'string') return appMeta.tenantId;

  const userMeta = payload.user_metadata as Record<string, unknown> | undefined;
  if (userMeta?.tenant_id && typeof userMeta.tenant_id === 'string') return userMeta.tenant_id;
  if (userMeta?.tenantId && typeof userMeta.tenantId === 'string') return userMeta.tenantId;

  return undefined;
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
    role: inferRoleFromPayload(payload),
    tenantId: inferTenantId(payload),
  };

  return apiResponse({ user });
};

export const GET = withAdminGuard(getHandler);
