import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getRfqProposals,
  updateRfqProposal,
  updateGroupRfq,
  RfqProposal,
} from '@/lib/supabase';
import { generateFactBombingReport } from '@/lib/rfq-ai';

// GET: 기 분석된 TOP 3 제안서 + 순위 반환 (캐시된 결과)
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    return NextResponse.json({
      ranked: MOCK_RANKED,
      key_insights: ['Mock 데이터입니다.'],
      mock: true,
    });
  }

  try {
    const proposals = await getRfqProposals(rfqId);
    const ranked = proposals
      .filter(p => p.rank != null)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    return NextResponse.json({ ranked, count: ranked.length });
  } catch (error) {
    console.error('분석 결과 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '분석 결과 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}

const MOCK_RANKED: RfqProposal[] = [
  {
    id: 'mock-proposal-001',
    rfq_id: 'mock-rfq-001',
    bid_id: 'mock-bid-001',
    tenant_id: 'mock-tenant-001',
    tenant_name: 'A여행사',
    proposal_title: '도쿄 완전 정복 4박 5일',
    total_cost: 18000000,
    total_selling_price: 24000000,
    hidden_cost_estimate: 500000,
    real_total_price: 24500000,
    checklist: {
      guide_fee: { included: true, amount: 0, note: '포함' },
      driver_tip: { included: true, amount: 0, note: '포함' },
      fuel_surcharge: { included: true, amount: 0, note: '포함' },
      local_tax: { included: true, amount: 0, note: '포함' },
      water_cost: { included: false, amount: 5000, note: '개인 부담' },
      inclusions: ['항공', '숙박', '전 식사'],
      exclusions: ['개인 음료'],
      optional_tours: [],
      hotel_info: { grade: '4성', name: '시부야 엑셀 호텔', notes: '' },
      meal_plan: '전식포함',
      transportation: '전세버스',
    },
    checklist_completed: true,
    ai_review: { score: 88, issues: [], suggestions: [], fact_check: [] },
    rank: 1,
    status: 'approved',
    submitted_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
];

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    return NextResponse.json({
      ranked: MOCK_RANKED,
      report_html: '<p><strong>Mock 팩트 폭격 리포트</strong>: Supabase 미설정 상태입니다.</p>',
      key_insights: ['Mock 데이터입니다.', 'Supabase를 설정하면 실제 분석이 가능합니다.'],
      mock: true,
    });
  }

  try {
    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

    const proposals = await getRfqProposals(rfqId);
    const submittedProposals = proposals.filter(
      p => p.status === 'submitted' || p.status === 'approved'
    );

    if (submittedProposals.length === 0) {
      return NextResponse.json(
        { error: '분석할 제안서가 없습니다.' },
        { status: 400 }
      );
    }

    const factResult = await generateFactBombingReport(rfq, submittedProposals);

    // 각 제안서의 순위 업데이트
    for (let i = 0; i < factResult.ranked.length; i++) {
      const rankedProposal = factResult.ranked[i];
      if (rankedProposal?.id) {
        await updateRfqProposal(rankedProposal.id, { rank: i + 1 });
      }
    }

    // RFQ 상태 전환
    if (rfq.status !== 'awaiting_selection') {
      await updateGroupRfq(rfqId, { status: 'awaiting_selection' });
    }

    return NextResponse.json({
      ranked: factResult.ranked,
      report_html: factResult.report_html,
      key_insights: factResult.key_insights,
    });
  } catch (error) {
    console.error('팩트 폭격 분석 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '분석에 실패했습니다.' },
      { status: 500 }
    );
  }
}
