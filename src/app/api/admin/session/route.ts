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
import { NextRequest, NextResponse } from 'next/server';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import { ADMIN_CACHE } from '@/lib/admin-cache';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';

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

const getHandler = async (req: NextRequest) => {
  if (process.env.NODE_ENV !== 'production' && req.cookies.get('ys-dev-admin')?.value === '1') {
    return NextResponse.json({
      user: {
        id: 'dev-admin',
        email: 'dev-admin@localhost',
        role: 'platform_admin',
      },
    }, { headers: ADMIN_CACHE.noCache });
  }

  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) {
    return NextResponse.json(
      { error: '세션 없음', user: null },
      { status: 401, headers: ADMIN_CACHE.noCache },
    );
  }

  const verified = await verifySupabaseAccessToken(token);
  if (!verified.ok || !verified.payload) {
    return NextResponse.json(
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

  return NextResponse.json({ user });
};

export const GET = withAdminGuard(getHandler);
