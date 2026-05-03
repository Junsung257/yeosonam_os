import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getTenant,
  getRfqBids,
  claimRfqBid,
  updateGroupRfq,
  RfqBid,
} from '@/lib/supabase';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500 }
    );
  }

  try {
    const bids = await getRfqBids(id);
    return NextResponse.json({ bids, count: bids.length });
  } catch (error) {
    console.error('입찰 목록 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '입찰 목록 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    // Mock fallback
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
    return NextResponse.json({ bid: mockBid, mock: true }, { status: 201 });
  }

  try {
    const { tenant_id } = await request.json();

    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id가 필요합니다.' }, { status: 400 });
    }

    // 1. RFQ 조회 및 상태 확인
    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (rfq.status !== 'published' && rfq.status !== 'bidding') {
      return NextResponse.json(
        { error: '현재 입찰이 가능한 상태가 아닙니다.' },
        { status: 409 }
      );
    }

    // 2. 테넌트 조회 및 티어 확인
    const tenant = await getTenant(tenant_id);
    if (!tenant) {
      return NextResponse.json({ error: '테넌트를 찾을 수 없습니다.' }, { status: 404 });
    }

    // tier 필드 (DB 컬럼 추가 예정 - optional chaining으로 안전 처리)
    const tier = (tenant as unknown as { tier?: string }).tier ?? 'bronze';
    let unlockAt: string | undefined;
    if (tier === 'gold') {
      unlockAt = rfq.gold_unlock_at ?? undefined;
    } else if (tier === 'silver') {
      unlockAt = rfq.silver_unlock_at ?? undefined;
    } else {
      unlockAt = rfq.bronze_unlock_at ?? undefined;
    }

    // 3. 노출 시간 확인
    if (unlockAt && new Date(unlockAt) > new Date()) {
      const minutesLeft = Math.ceil((new Date(unlockAt).getTime() - Date.now()) / 60000);
      return NextResponse.json(
        { error: `아직 노출되지 않은 공고입니다 (${minutesLeft}분 후 오픈)` },
        { status: 403 }
      );
    }

    // 4. 입찰 마감 확인
    if (rfq.bid_deadline && new Date(rfq.bid_deadline) < new Date()) {
      return NextResponse.json({ error: '입찰 마감' }, { status: 410 });
    }

    // 5. 최대 제안 수 확인
    const existingBids = await getRfqBids(rfqId);
    const activeBids = existingBids.filter(b => b.status === 'locked' || b.status === 'submitted');
    if (activeBids.length >= rfq.max_proposals) {
      return NextResponse.json({ error: '마감' }, { status: 410 });
    }

    // 6. 입찰 슬롯 확보 (선착순)
    const bid = await claimRfqBid(rfqId, tenant_id);
    if (!bid) {
      return NextResponse.json(
        { error: '이미 입찰에 참여하셨거나 입찰 처리에 실패했습니다.' },
        { status: 409 }
      );
    }

    // 7. RFQ 상태를 bidding으로 전환
    await updateGroupRfq(rfqId, { status: 'bidding' });

    return NextResponse.json({ bid }, { status: 201 });
  } catch (error) {
    console.error('입찰 참여 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '입찰 처리에 실패했습니다.' },
      { status: 500 }
    );
  }
}
