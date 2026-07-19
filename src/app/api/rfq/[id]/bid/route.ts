import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured } from '@/lib/supabase';
import { claimRfqBid, getGroupRfq, getRfqBids, getRfqTenantForAuthorizedRequest, updateGroupRfq } from '@/lib/db/rfq-server';
import {
  resolveRfqActor,
  rfqForbiddenResponse,
  rfqUnauthorizedResponse,
} from '@/lib/rfq-request-auth';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;

  const actor = await resolveRfqActor(request);
  if (!actor) return rfqUnauthorizedResponse();

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('rfq_bid');
  }

  try {
    const allBids = await getRfqBids(id);
    const bids = actor.kind === 'admin'
      ? allBids
      : allBids.filter((bid) => bid.tenant_id === actor.tenantId);
    return apiResponse(
      { bids, count: bids.length },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
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

  const actor = await resolveRfqActor(request);
  if (!actor) return rfqUnauthorizedResponse();

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('rfq_bid');
  }

  const body = await request.json() as { tenant_id?: unknown };
  const requestedTenantId = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : '';
  if (actor.kind === 'tenant' && requestedTenantId && requestedTenantId !== actor.tenantId) {
    return rfqForbiddenResponse();
  }
  const tenantId = actor.kind === 'tenant' ? actor.tenantId : requestedTenantId;
  if (!tenantId) {
    return apiResponse({ error: 'tenant_id가 필요합니다.' }, { status: 400 });
  }

  try {
    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return apiResponse({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (rfq.status !== 'published' && rfq.status !== 'bidding') {
      return apiResponse(
        { error: '현재 입찰 가능한 상태가 아닙니다.' },
        { status: 409 },
      );
    }

    const tenant = await getRfqTenantForAuthorizedRequest(tenantId);
    if (!tenant) {
      return apiResponse({ error: '테넌트를 찾을 수 없습니다.' }, { status: 404 });
    }

    const tier = tenant.tier;
    let unlockAt: string | undefined;
    if (tier === 'GOLD') {
      unlockAt = rfq.gold_unlock_at ?? undefined;
    } else if (tier === 'SILVER') {
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

    const existingBids = await getRfqBids(rfqId);
    const activeBids = existingBids.filter(b => b.status === 'locked' || b.status === 'submitted');
    if (activeBids.length >= rfq.max_proposals) {
      return apiResponse({ error: '마감' }, { status: 410 });
    }

    const bid = await claimRfqBid(rfqId, tenantId);
    if (!bid) {
      return apiResponse(
        { error: '이미 입찰에 참여했거나 입찰 처리에 실패했습니다.' },
        { status: 409 },
      );
    }

    await updateGroupRfq(rfqId, { status: 'bidding' });

    return apiResponse({ bid }, { status: 201 });
  } catch (error) {
    console.error('[rfq/bid] claim failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '입찰 처리에 실패했습니다.') },
      { status: 500 },
    );
  }
}
