import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getTenant,
  getRfqBids,
  GroupRfq,
} from '@/lib/supabase';
import { sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';

export async function GET(request: NextRequest, props: { params: Promise<{ rfqId: string }> }) {
  const params = await props.params;
  const { rfqId } = params;
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id');

  if (!tenantId) {
    return NextResponse.json({ error: 'tenant_id가 필요합니다.' }, { status: 400 });
  }

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('tenant_rfq');
  }

  try {
    const [rfq, tenant] = await Promise.all([
      getGroupRfq(rfqId),
      getTenant(tenantId),
    ]);

    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }
    if (!tenant) {
      return NextResponse.json({ error: '테넌트를 찾을 수 없습니다.' }, { status: 404 });
    }

    const tier = (tenant as unknown as { tier?: string }).tier ?? 'bronze';
    const now = new Date();

    let unlockAt: string | undefined;
    if (tier === 'gold')        unlockAt = rfq.gold_unlock_at   ?? undefined;
    else if (tier === 'silver') unlockAt = rfq.silver_unlock_at ?? undefined;
    else                        unlockAt = rfq.bronze_unlock_at ?? undefined;

    const isUnlocked = !unlockAt || new Date(unlockAt) <= now;

    const bids = await getRfqBids(rfqId);
    const myBid = bids.find(b => b.tenant_id === tenantId) ?? null;

    // 고객 개인정보 마스킹
    const sanitized: Partial<GroupRfq> & { customer_name: string } = {
      ...rfq,
      customer_name: '고객 (익명)',
      customer_phone: undefined,
      customer_id: undefined,
    };

    return NextResponse.json({
      rfq: sanitized,
      is_unlocked: isUnlocked,
      my_bid: myBid
        ? {
            id: myBid.id,
            status: myBid.status,
            locked_at: myBid.locked_at,
            submit_deadline: myBid.submit_deadline,
            submitted_at: myBid.submitted_at,
          }
        : null,
    });
  } catch (error) {
    console.error('테넌트 RFQ 상세 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}
