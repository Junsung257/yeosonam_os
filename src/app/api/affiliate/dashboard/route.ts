import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { buildAffiliateDashboardById } from '@/lib/affiliate/dashboard-service';
import { authAffiliate } from '@/lib/affiliate/auth-service';
import { isSupabaseAdminConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: 'DB is not configured' }, { status: 503 });
  }

  const auth = await authAffiliate(request);
  if (!auth.ok) return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });

  try {
    const dashboard = await buildAffiliateDashboardById(String(auth.affiliate.id));
    if (!dashboard) {
      return apiResponse({ error: 'Affiliate not found' }, { status: 404 });
    }
    return apiResponse(dashboard);
  } catch {
    return apiResponse({ error: 'AFFILIATE_DASHBOARD_UNAVAILABLE', state: 'data_unavailable' }, { status: 503 });
  }
}
