import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { buildAffiliateDashboardByCode } from '@/lib/affiliate/dashboard-service';

export const runtime = 'nodejs';

// POST /api/influencer/dashboard
// Auth: inf_token cookie first, otherwise referral_code + PIN through the shared affiliate auth service.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const referralCode = typeof body.referral_code === 'string' ? body.referral_code : '';

    if (!referralCode) {
      return apiResponse({ error: 'referral_code is required' }, { status: 400 });
    }

    const dashboard = await buildAffiliateDashboardByCode(referralCode, request, body.pin);
    if ('authError' in dashboard) {
      return apiResponse({ error: dashboard.authError.error }, { status: dashboard.authError.status });
    }

    return apiResponse(dashboard);
  } catch (err) {
    return apiResponse(
      { error: err instanceof Error ? err.message : 'Dashboard fetch failed' },
      { status: 500 },
    );
  }
}
