import { NextRequest } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { listTenants, createTenant, isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

const PRIVATE_NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: 'Supabase admin connection is not configured.' }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS });
  }
  try {
    const tenants = await listTenants();
    const includeStats = request.nextUrl.searchParams.get('include_stats') === '1';
    if (!includeStats) return apiResponse({ tenants }, { headers: PRIVATE_NO_STORE_HEADERS });

    const month = request.nextUrl.searchParams.get('month') ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return apiResponse({ error: 'month는 YYYY-MM 형식이어야 합니다.' }, { status: 400, headers: PRIVATE_NO_STORE_HEADERS });
    }
    const { data, error } = await supabaseAdmin.rpc('get_admin_tenant_summaries', { p_month: month });
    if (error) throw error;
    const stats = Object.fromEntries((data ?? []).map((row: Record<string, unknown>) => [
      String(row.tenant_id),
      {
        product_count: Number(row.product_count) || 0,
        sale_count: Number(row.sale_count) || 0,
        settlement_cost: Number(row.settlement_cost) || 0,
      },
    ]));
    return apiResponse({ tenants, stats, month }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    console.error('[tenants] summary query failed:', sanitizeDbError(error));
    return apiResponse({ error: '테넌트 현황을 조회하지 못했습니다.' }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: 'Supabase is not configured' }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS });
  }

  const body = await request.json();
  if (!body.name) return apiResponse({ error: 'name is required' }, { status: 400, headers: PRIVATE_NO_STORE_HEADERS });
  const tenant = await createTenant(body);
  if (!tenant) return apiResponse({ error: '테넌트를 저장하지 못했습니다.' }, { status: 503, headers: PRIVATE_NO_STORE_HEADERS });
  return apiResponse({ tenant }, { status: 201, headers: PRIVATE_NO_STORE_HEADERS });
}
