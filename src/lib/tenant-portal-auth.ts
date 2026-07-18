/**
 * Tenant portal authorization boundary.
 *
 * Tenant scope never comes from JWT user_metadata, URL parameters, or request
 * bodies. A verified Supabase user must have an active DB membership for the
 * exact requested tenant. Platform admins use the existing admin token/email
 * contract for intentional support and preview access.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isValidAdminApiToken } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify';
import { isUuid } from '@/lib/uuid';

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

function hasExplicitDevAdminCookie(request: NextRequest): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return request.cookies.get('ys-dev-admin')?.value === '1'
    || Boolean(request.cookies.get('sb-admin')?.value);
}

export function isTenantPortalAuthError(
  value: TenantPortalActor | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}

export async function requireTenantPortalRequest(
  request: NextRequest,
  requestedTenantId: string,
): Promise<TenantPortalActor | NextResponse> {
  const tenantId = requestedTenantId.trim();
  if (!isUuid(tenantId)) {
    return privateError('INVALID_TENANT', '올바른 tenant_id가 필요합니다.', 400);
  }

  if (isValidAdminApiToken(request) || hasExplicitDevAdminCookie(request)) {
    return {
      tenantId,
      userId: isValidAdminApiToken(request) ? 'admin_api_token' : 'dev_admin',
      role: 'platform_admin',
      isPlatformAdmin: true,
    };
  }

  const token = request.cookies.get('sb-access-token')?.value;
  if (!token) {
    return privateError('UNAUTHORIZED', '로그인이 필요합니다.', 401);
  }

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
    console.error('[tenant-portal-auth] membership lookup failed', {
      code: error.code,
    });
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
