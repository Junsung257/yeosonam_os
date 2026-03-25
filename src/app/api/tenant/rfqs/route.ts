import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getTenant,
  listGroupRfqs,
  getRfqBids,
  GroupRfq,
} from '@/lib/supabase';

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

const MOCK_TENANT_RFQS: RfqWithTierInfo[] = [
  {
    id: 'mock-rfq-001',
    rfq_code: 'GRP-1001',
    customer_name: '고객 (익명)',
    destination: '일본 도쿄',
    adult_count: 20,
    child_count: 5,
    budget_per_person: 1200000,
    hotel_grade: '4성',
    meal_plan: '전식포함',
    transportation: '전세버스',
    status: 'published',
    published_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    gold_unlock_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    silver_unlock_at: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(),
    bronze_unlock_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    bid_deadline: new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString(),
    max_proposals: 3,
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    is_unlocked: true,
    my_bid: null,
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id');

  if (!tenantId) {
    return NextResponse.json({ error: 'tenant_id가 필요합니다.' }, { status: 400 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ rfqs: MOCK_TENANT_RFQS, mock: true });
  }

  try {
    // 테넌트 조회 (티어 확인)
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return NextResponse.json({ error: '테넌트를 찾을 수 없습니다.' }, { status: 404 });
    }

    const tier = (tenant as unknown as { tier?: string }).tier ?? 'bronze';
    const now = new Date();

    // status IN ('published', 'bidding') 인 RFQ 조회
    const publishedRfqs = await listGroupRfqs('published');
    const biddingRfqs = await listGroupRfqs('bidding');
    const allRfqs = [...publishedRfqs, ...biddingRfqs];

    // bid_deadline이 아직 안 지난 것만 필터
    const activeRfqs = allRfqs.filter(rfq => {
      if (!rfq.bid_deadline) return true;
      return new Date(rfq.bid_deadline) > now;
    });

    // 티어별 unlock_at 확인 및 my_bid 조회
    const enriched: RfqWithTierInfo[] = await Promise.all(
      activeRfqs.map(async rfq => {
        let unlockAt: string | undefined;
        if (tier === 'gold') {
          unlockAt = rfq.gold_unlock_at ?? undefined;
        } else if (tier === 'silver') {
          unlockAt = rfq.silver_unlock_at ?? undefined;
        } else {
          unlockAt = rfq.bronze_unlock_at ?? undefined;
        }

        const isUnlocked = !unlockAt || new Date(unlockAt) <= now;
        const unlocksInSeconds = !isUnlocked && unlockAt
          ? Math.ceil((new Date(unlockAt).getTime() - now.getTime()) / 1000)
          : undefined;

        // 해당 테넌트의 기존 입찰 확인
        const bids = await getRfqBids(rfq.id);
        const myBid = bids.find(b => b.tenant_id === tenantId);

        // 고객 개인정보 마스킹
        const sanitized: RfqWithTierInfo = {
          ...rfq,
          customer_name: '고객 (익명)',
          customer_phone: undefined,
          customer_id: undefined,
          is_unlocked: isUnlocked,
          unlocks_in_seconds: unlocksInSeconds,
          my_bid: myBid
            ? {
                id: myBid.id,
                status: myBid.status,
                locked_at: myBid.locked_at,
                submit_deadline: myBid.submit_deadline,
              }
            : null,
        };

        return sanitized;
      })
    );

    return NextResponse.json({ rfqs: enriched, count: enriched.length });
  } catch (error) {
    console.error('테넌트 RFQ 목록 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 목록 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}
