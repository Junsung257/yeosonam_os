/**
 * Tenant portal authorization boundary.
 *
 * A tenant id supplied by a URL, query string, or request body is only a
 * routing hint. Authorization is decided from a verified Supabase subject
 * and an active membership row for that exact tenant.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isValidAdminApiToken } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import { isUuid } from '@/lib/uuid';
import type { Tenant } from '@/lib/db/tenant';

export type TenantPortalActor = {
  tenantId: string;
  userId: string;
  role: 'platform_admin' | 'tenant_admin' | 'tenant_staff';
  isPlatformAdmin: boolean;
};

type MembershipRow = {
  tenant_id: string;
  role: 'tenant_admin' | 'tenant_staff';
  is_active: boolean;
  tenants: { status: string } | null;
};

function privateError(code: string, error: string, status: number): NextResponse {
  const response = apiResponse({ code, error }, { status });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

function configuredAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isTenantPortalAuthError(
  value: TenantPortalActor | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}

export function requireTenantAdminRole(actor: TenantPortalActor): NextResponse | null {
  if (actor.isPlatformAdmin || actor.role === 'tenant_admin') return null;
  return privateError('FORBIDDEN', '테넌트 관리자 권한이 필요합니다.', 403);
}

function bearerOrCookieToken(request: NextRequest): string | undefined {
  const cookieToken = request.cookies.get('sb-access-token')?.value;
  if (cookieToken) return cookieToken;
  const authorization = request.headers.get('authorization');
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || undefined;
}

/**
 * Require access to one exact active tenant.
 *
 * Platform admin credentials retain support access. Every other caller must
 * have an active tenant_memberships row. No user_metadata or caller-supplied
 * role is used for authorization.
 */
export async function requireTenantPortalRequest(
  request: NextRequest,
  requestedTenantId: string,
): Promise<TenantPortalActor | NextResponse> {
  const tenantId = requestedTenantId.trim();
  if (!isUuid(tenantId)) {
    return privateError('INVALID_TENANT', '올바른 tenant_id가 필요합니다.', 400);
  }

  if (isValidAdminApiToken(request)) {
    return {
      tenantId,
      userId: 'admin_api_token',
      role: 'platform_admin',
      isPlatformAdmin: true,
    };
  }

  const token = bearerOrCookieToken(request);
  if (!token) return privateError('UNAUTHORIZED', '로그인이 필요합니다.', 401);

  const verified = await verifySupabaseAccessToken(token);
  if (!verified.ok || typeof verified.payload.sub !== 'string' || !isUuid(verified.payload.sub)) {
    return privateError('UNAUTHORIZED', '유효한 로그인이 필요합니다.', 401);
  }

  const email = typeof verified.payload.email === 'string'
    ? verified.payload.email.trim().toLowerCase()
    : '';
  if (email && configuredAdminEmails().has(email)) {
    return {
      tenantId,
      userId: verified.payload.sub,
      role: 'platform_admin',
      isPlatformAdmin: true,
    };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return privateError(
      'TENANT_AUTH_UNAVAILABLE',
      '테넌트 권한을 확인할 수 없습니다.',
      503,
    );
  }

  const { data, error } = await admin
    .from('tenant_memberships')
    .select('tenant_id, role, is_active, tenants!inner(status)')
    .eq('tenant_id', tenantId)
    .eq('user_id', verified.payload.sub)
    .eq('is_active', true)
    .eq('tenants.status', 'active')
    .maybeSingle();

  if (error) {
    console.error('[tenant-portal-auth] membership lookup failed', { code: error.code });
    return privateError(
      'TENANT_AUTH_UNAVAILABLE',
      '테넌트 권한을 확인할 수 없습니다.',
      503,
    );
  }

  const membership = data as MembershipRow | null;
  if (
    !membership
    || membership.tenant_id !== tenantId
    || !membership.is_active
    || membership.tenants?.status !== 'active'
  ) {
    return privateError('FORBIDDEN', '이 테넌트에 접근할 권한이 없습니다.', 403);
  }

  if (membership.role !== 'tenant_admin' && membership.role !== 'tenant_staff') {
    return privateError('FORBIDDEN', '유효한 테넌트 역할이 없습니다.', 403);
  }

  return {
    tenantId,
    userId: verified.payload.sub,
    role: membership.role,
    isPlatformAdmin: false,
  };
}

/** Read a tenant after the caller has crossed the portal authorization boundary. */
export async function getTenantPortalTenant(tenantId: string): Promise<Tenant | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const { data, error } = await admin
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    console.error('[tenant-portal-auth] tenant lookup failed', { code: error.code });
    return null;
  }
  return data as Tenant | null;
}
