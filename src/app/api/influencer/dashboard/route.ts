import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { buildAffiliateDashboardByCode } from '@/lib/affiliate/dashboard-service';
import { isAllowedPartnerWriteOrigin } from '@/lib/affiliate/write-origin';

export const runtime = 'nodejs';

// POST /api/influencer/dashboard
// Auth: revocable partner_session cookie through the shared affiliate auth service.
export async function POST(request: NextRequest) {
  if (!isAllowedPartnerWriteOrigin(request)) {
    return apiResponse({ error: 'ORIGIN_REJECTED' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const referralCode = typeof body.referral_code === 'string' ? body.referral_code : '';

    if (!referralCode) {
      return apiResponse({ error: 'referral_code is required' }, { status: 400 });
    }

    const dashboard = await buildAffiliateDashboardByCode(referralCode, request);
    if ('authError' in dashboard) {
      return apiResponse({ error: dashboard.authError.error }, { status: dashboard.authError.status });
    }

    return apiResponse(dashboard);
  } catch {
    return apiResponse({ error: 'AFFILIATE_DASHBOARD_UNAVAILABLE', state: 'data_unavailable' }, { status: 503 });
  }
}
