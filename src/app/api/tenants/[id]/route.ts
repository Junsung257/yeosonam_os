import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { requireAdminRequest } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, updateTenant } from '@/lib/supabase';
import {
  isTenantPortalAuthError,
  requireTenantPortalRequest,
} from '@/lib/tenant-portal-auth';
import { getTenantPortalTenant } from '@/lib/tenant-portal-rfq';

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
  const authorization = await requireTenantPortalRequest(request, id);
  if (isTenantPortalAuthError(authorization)) return authorization;
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
  }

  const tenant = await getTenantPortalTenant(authorization.tenantId);
  if (!tenant) return apiResponse({ error: '테넌트를 찾을 수 없습니다.' }, { status: 404 });
  return apiResponse(
    { tenant },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
  }

  const { id } = await props.params;
  const body = await request.json() as Record<string, unknown>;
  const allowed = {
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(typeof body.contact_name === 'string' ? { contact_name: body.contact_name } : {}),
    ...(typeof body.contact_phone === 'string' ? { contact_phone: body.contact_phone } : {}),
    ...(typeof body.contact_email === 'string' ? { contact_email: body.contact_email } : {}),
    ...(typeof body.commission_rate === 'number' ? { commission_rate: body.commission_rate } : {}),
    ...(typeof body.status === 'string' ? { status: body.status as 'active' | 'inactive' | 'suspended' } : {}),
    ...(typeof body.description === 'string' ? { description: body.description } : {}),
    ...(typeof body.tier === 'string' ? { tier: body.tier as 'GOLD' | 'SILVER' | 'BRONZE' } : {}),
  };
  await updateTenant(id, allowed);
  return apiResponse({ ok: true });
}
