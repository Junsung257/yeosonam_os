import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getTenant,
  getRfqBids,
  claimRfqBid,
  updateGroupRfq,
  type RfqBid,
} from '@/lib/supabase';

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;

  if (!isSupabaseConfigured) {
    return apiResponse(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 },
    );
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
    const { tenant_id } = await request.json();
    const mockBid: RfqBid = {
      id: `mock-bid-${Date.now()}`,
      rfq_id: rfqId,
      tenant_id: tenant_id ?? 'mock-tenant',
      status: 'locked',
      locked_at: new Date().toISOString(),
      submit_deadline: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      is_penalized: false,
    };
    return apiResponse({ bid: mockBid, mock: true }, { status: 201 });
  }

  try {
    const { tenant_id } = await request.json();

    if (!tenant_id) {
      return apiResponse({ error: 'tenant_id가 필요합니다.' }, { status: 400 });
    }

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

    const tenant = await getTenant(tenant_id);
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

    const existingBids = await getRfqBids(rfqId);
    const activeBids = existingBids.filter(b => b.status === 'locked' || b.status === 'submitted');
    if (activeBids.length >= rfq.max_proposals) {
      return apiResponse({ error: '마감' }, { status: 410 });
    }

    const bid = await claimRfqBid(rfqId, tenant_id);
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
