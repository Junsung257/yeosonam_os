import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { requireAdminRequest } from '@/lib/admin-guard';
import {
  createTenant,
  isSupabaseAdminConfigured,
  listTenants,
  type Tenant,
} from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
  }

  const tenants = await listTenants();
  return apiResponse(
    { tenants },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: '테넌트 저장소를 사용할 수 없습니다.' }, { status: 503 });
  }

  const body = await request.json() as Partial<Tenant>;
  if (!body.name?.trim()) {
    return apiResponse({ error: 'name이 필요합니다.' }, { status: 400 });
  }
  const tenant = await createTenant({
    name: body.name.trim(),
    contact_name: body.contact_name,
    contact_phone: body.contact_phone,
    contact_email: body.contact_email,
    commission_rate: Number(body.commission_rate ?? 18),
    status: body.status ?? 'active',
    description: body.description,
    tier: body.tier ?? 'BRONZE',
    reliability_score: Number(body.reliability_score ?? 100),
  });
  if (!tenant) return apiResponse({ error: '테넌트를 만들지 못했습니다.' }, { status: 500 });
  return apiResponse({ tenant }, { status: 201 });
}
