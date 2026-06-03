import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { buildAffiliateDashboardById } from '@/lib/affiliate/dashboard-service';
import { verifyAffiliateToken } from '@/lib/affiliate/jwt-auth';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

function resolveToken(request: NextRequest): string {
  const cookieToken = request.cookies.get('inf_token')?.value || '';
  if (cookieToken) return cookieToken;

  const auth = request.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'DB is not configured' }, { status: 503 });
  }

  const rawToken = resolveToken(request);
  if (!rawToken) {
    return apiResponse({ error: 'Authentication required' }, { status: 401 });
  }

  const token = await verifyAffiliateToken(rawToken);
  if (!token.ok) {
    return apiResponse({ error: 'Invalid token' }, { status: 401 });
  }

  try {
    const dashboard = await buildAffiliateDashboardById(token.affiliateId);
    if (!dashboard) {
      return apiResponse({ error: 'Affiliate not found' }, { status: 404 });
    }
    return apiResponse(dashboard);
  } catch (err) {
    return apiResponse(
      { error: err instanceof Error ? err.message : 'Dashboard fetch failed' },
      { status: 500 },
    );
  }
}
