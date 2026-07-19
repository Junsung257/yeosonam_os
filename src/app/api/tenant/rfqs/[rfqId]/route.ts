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
  getTenantPortalRfq,
  getTenantPortalTenant,
  sanitizeTenantPortalRfq,
} from '@/lib/tenant-portal-rfq';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';

function tierUnlockAt(rfq: GroupRfq, tier: string): string | undefined {
  const normalized = tier.toLowerCase();
  if (normalized === 'gold') return rfq.gold_unlock_at ?? undefined;
  if (normalized === 'silver') return rfq.silver_unlock_at ?? undefined;
  return rfq.bronze_unlock_at ?? undefined;
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ rfqId: string }> },
) {
  const requestedTenantId = request.nextUrl.searchParams.get('tenant_id') ?? '';
  const authorization = await requireTenantPortalRequest(request, requestedTenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;
  if (!isSupabaseAdminConfigured) {
    return sensitiveBackendUnavailable('tenant_rfq');
  }

  try {
    const { rfqId } = await props.params;
    const [rfq, tenant, myBid] = await Promise.all([
      getTenantPortalRfq(rfqId),
      getTenantPortalTenant(authorization.tenantId),
      getTenantPortalBid(rfqId, authorization.tenantId),
    ]);
    if (!rfq) return apiResponse({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    if (!tenant) return apiResponse({ error: '테넌트를 찾을 수 없습니다.' }, { status: 404 });
    if (tenant.status !== 'active') {
      return apiResponse({ error: '비활성 테넌트는 RFQ에 접근할 수 없습니다.' }, { status: 403 });
    }
    const isPublishedForTenantBidding = rfq.status === 'published' || rfq.status === 'bidding';
    if (!isPublishedForTenantBidding && !myBid) {
      // Do not reveal draft/cancelled/completed RFQ existence through a guessed UUID.
      // A tenant may still reopen an RFQ it already owns a bid for.
      return apiResponse({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

    const now = new Date();
    const unlockAt = tierUnlockAt(rfq, tenant.tier ?? 'bronze');
    const isUnlocked = !unlockAt || new Date(unlockAt) <= now;
    if (!isUnlocked && !myBid) {
      return apiResponse(
        {
          code: 'RFQ_TIER_LOCKED',
          error: '티어 등급에 따라 아직 공개되지 않은 RFQ입니다.',
          unlocks_in_seconds: unlockAt
            ? Math.max(1, Math.ceil((new Date(unlockAt).getTime() - now.getTime()) / 1000))
            : undefined,
        },
        {
          status: 403,
          headers: { 'Cache-Control': 'private, no-store' },
        },
      );
    }

    const sanitized = sanitizeTenantPortalRfq(rfq);

    return apiResponse({
      rfq: sanitized,
      is_unlocked: isUnlocked,
      my_bid: myBid ? {
        id: myBid.id,
        status: myBid.status,
        locked_at: myBid.locked_at,
        submit_deadline: myBid.submit_deadline,
        submitted_at: myBid.submitted_at,
      } : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[tenant/rfqs] detail failed', sanitizeDbError(error));
    return apiResponse({ error: 'RFQ 조회에 실패했습니다.' }, { status: 500 });
  }
}
