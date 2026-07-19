import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseAdminConfigured, type GroupRfq } from '@/lib/supabase';
import {
  isTenantPortalAuthError,
  requireTenantPortalRequest,
} from '@/lib/tenant-portal-auth';
import {
  getTenantPortalBid,
  getTenantPortalTenant,
  listTenantPortalRfqs,
  sanitizeTenantPortalRfq,
} from '@/lib/tenant-portal-rfq';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';

interface RfqWithTierInfo extends GroupRfq {
  is_unlocked: boolean;
  unlocks_in_seconds?: number;
  my_bid?: {
    id: string;
    status: string;
    locked_at: string;
    submit_deadline: string;
  } | null;
}

function tierUnlockAt(rfq: GroupRfq, tier: string): string | undefined {
  const normalized = tier.toLowerCase();
  if (normalized === 'gold') return rfq.gold_unlock_at ?? undefined;
  if (normalized === 'silver') return rfq.silver_unlock_at ?? undefined;
  return rfq.bronze_unlock_at ?? undefined;
}

export async function GET(request: NextRequest) {
  const requestedTenantId = request.nextUrl.searchParams.get('tenant_id') ?? '';
  const authorization = await requireTenantPortalRequest(request, requestedTenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;
  if (!isSupabaseAdminConfigured) {
    return sensitiveBackendUnavailable('tenant_rfqs');
  }

  try {
    const tenant = await getTenantPortalTenant(authorization.tenantId);
    if (!tenant) return apiResponse({ error: '테넌트를 찾을 수 없습니다.' }, { status: 404 });
    if (tenant.status !== 'active') {
      return apiResponse({ error: '비활성 테넌트는 RFQ에 접근할 수 없습니다.' }, { status: 403 });
    }

    const now = new Date();
    const activeRfqs = (await listTenantPortalRfqs()).filter((rfq) => (
      !rfq.bid_deadline || new Date(rfq.bid_deadline) > now
    ));

    const enriched: RfqWithTierInfo[] = await Promise.all(activeRfqs.map(async (rfq) => {
      const unlockAt = tierUnlockAt(rfq, tenant.tier ?? 'bronze');
      const isUnlocked = !unlockAt || new Date(unlockAt) <= now;
      const myBid = await getTenantPortalBid(rfq.id, authorization.tenantId);
      return {
        ...sanitizeTenantPortalRfq(rfq),
        is_unlocked: isUnlocked,
        unlocks_in_seconds: !isUnlocked && unlockAt
          ? Math.ceil((new Date(unlockAt).getTime() - now.getTime()) / 1000)
          : undefined,
        my_bid: myBid ? {
          id: myBid.id,
          status: myBid.status,
          locked_at: myBid.locked_at,
          submit_deadline: myBid.submit_deadline,
        } : null,
      };
    }));

    return apiResponse(
      { rfqs: enriched, count: enriched.length },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[tenant/rfqs] list failed', sanitizeDbError(error));
    return apiResponse({ error: 'RFQ 목록 조회에 실패했습니다.' }, { status: 500 });
  }
}
