import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  getGroupRfq,
  getRfqBids,
  isSupabaseConfigured,
  isSupabaseAdminConfigured,
} from '@/lib/supabase';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';
import {
  getTenantPortalTenant,
  isTenantPortalAuthError,
  requireTenantPortalRequest,
} from '@/lib/tenant-portal-auth';
import {
  claimAuthorizedRfqBid,
  getServerGroupRfq,
  getServerRfqBids,
  updateServerGroupRfq,
} from '@/lib/db/rfq-server';

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('rfq_bid');
  }

  try {
    const bids = await getRfqBids(id);
    return apiResponse({ bids, count: bids.length });
  } catch (error) {
    console.error('[rfq/bid] list failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '입찰 목록 조회에 실패했습니다.') },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('rfq_bid');
  }
  if (!isSupabaseAdminConfigured) {
    return sensitiveBackendUnavailable('rfq_bid');
  }

  const body = await request.json().catch(() => ({})) as { tenant_id?: unknown };
  const requestedTenantId = typeof body.tenant_id === 'string' ? body.tenant_id : '';
  const authorization = await requireTenantPortalRequest(request, requestedTenantId);
  if (isTenantPortalAuthError(authorization)) return authorization;

  try {
    const rfq = await getServerGroupRfq(rfqId);
    if (!rfq) {
      return apiResponse({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (rfq.status !== 'published' && rfq.status !== 'bidding') {
      return apiResponse(
        { error: '현재 입찰 가능한 상태가 아닙니다.' },
        { status: 409 },
      );
    }

    const tenant = await getTenantPortalTenant(authorization.tenantId);
    if (!tenant) {
      return apiResponse({ error: '테넌트를 찾을 수 없습니다.' }, { status: 404 });
    }

    const tier = (tenant as unknown as { tier?: string }).tier ?? 'bronze';
    let unlockAt: string | undefined;
    if (tier === 'gold') {
      unlockAt = rfq.gold_unlock_at ?? undefined;
    } else if (tier === 'silver') {
      unlockAt = rfq.silver_unlock_at ?? undefined;
    } else {
      unlockAt = rfq.bronze_unlock_at ?? undefined;
    }

    if (unlockAt && new Date(unlockAt) > new Date()) {
      const minutesLeft = Math.ceil((new Date(unlockAt).getTime() - Date.now()) / 60000);
      return apiResponse(
        { error: `아직 입찰할 수 없습니다. (${minutesLeft}분 후 오픈)` },
        { status: 403 },
      );
    }

    if (rfq.bid_deadline && new Date(rfq.bid_deadline) < new Date()) {
      return apiResponse({ error: '입찰 마감' }, { status: 410 });
    }

    const existingBids = await getServerRfqBids(rfqId);
    const activeBids = existingBids.filter(b => b.status === 'locked' || b.status === 'submitted');
    if (activeBids.length >= rfq.max_proposals) {
      return apiResponse({ error: '마감' }, { status: 410 });
    }

    const existingTenantBid = existingBids.find(
      (candidate) => candidate.tenant_id === authorization.tenantId,
    );
    if (existingTenantBid) {
      return apiResponse(
        { error: '이미 입찰에 참여했거나 입찰 처리에 실패했습니다.' },
        { status: 409 },
      );
    }

    const bid = await claimAuthorizedRfqBid(rfqId, authorization.tenantId);
    if (!bid) {
      return apiResponse(
        { error: '이미 입찰에 참여했거나 입찰 처리에 실패했습니다.' },
        { status: 409 },
      );
    }

    await updateServerGroupRfq(rfqId, { status: 'bidding' });

    return apiResponse({ bid }, { status: 201 });
  } catch (error) {
    console.error('[rfq/bid] claim failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '입찰 처리에 실패했습니다.') },
      { status: 500 },
    );
  }
}
