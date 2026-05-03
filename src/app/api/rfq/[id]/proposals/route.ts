import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getRfqProposals,
  RfqProposal,
} from '@/lib/supabase';

const MOCK_PROPOSALS: RfqProposal[] = [
  {
    id: 'mock-proposal-001',
    rfq_id: 'mock-rfq-001',
    bid_id: 'mock-bid-001',
    tenant_id: 'mock-tenant-001',
    tenant_name: 'A여행사',
    proposal_title: '도쿄 완전 정복 4박 5일',
    itinerary_summary: '센소지→도쿄스카이트리→시부야→아키하바라 코스',
    total_cost: 18000000,
    total_selling_price: 24000000,
    hidden_cost_estimate: 500000,
    real_total_price: 24500000,
    checklist: {
      guide_fee:      { included: true,  amount: 0,     note: '가이드비 포함' },
      driver_tip:     { included: true,  amount: 0,     note: '기사 팁 포함' },
      fuel_surcharge: { included: true,  amount: 0,     note: '유류 할증 포함' },
      local_tax:      { included: true,  amount: 0,     note: '현지 세금 포함' },
      water_cost:     { included: false, amount: 5000,  note: '개인 부담 (1일 1병)' },
      inclusions:     ['항공', '숙박(4성)', '전 식사', '전세버스'],
      exclusions:     ['개인 음료', '추가 쇼핑'],
      optional_tours: [{ name: '닛코 당일치기', price: 80000 }],
      hotel_info:     { grade: '4성', name: '시부야 엑셀 호텔', notes: '트윈룸 기준' },
      meal_plan:      '전식포함',
      transportation: '전세버스',
    },
    checklist_completed: true,
    ai_review: {
      score: 88,
      issues: [],
      suggestions: ['불포함 음료 비용을 상세 명시하면 고객 신뢰도가 높아집니다.'],
      fact_check: ['판매가 2400만원 대비 원가율 75%로 적정 수준'],
    },
    rank: 1,
    status: 'approved',
    submitted_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
  {
    id: 'mock-proposal-002',
    rfq_id: 'mock-rfq-001',
    bid_id: 'mock-bid-002',
    tenant_id: 'mock-tenant-002',
    tenant_name: 'B여행사',
    proposal_title: '도쿄 가족여행 알뜰 패키지',
    itinerary_summary: '디즈니랜드→우에노→아사쿠사→아키하바라',
    total_cost: 16000000,
    total_selling_price: 21000000,
    hidden_cost_estimate: 1200000,
    real_total_price: 22200000,
    checklist: {
      guide_fee:      { included: false, amount: 200000, note: '별도 청구' },
      driver_tip:     { included: true,  amount: 0,      note: '포함' },
      fuel_surcharge: { included: true,  amount: 0,      note: '포함' },
      local_tax:      { included: true,  amount: 0,      note: '포함' },
      water_cost:     { included: false, amount: 5000,   note: '개인 부담' },
      inclusions:     ['항공', '숙박(4성)', '조식'],
      exclusions:     ['가이드비', '중식·석식', '개인 음료'],
      optional_tours: [],
      hotel_info:     { grade: '4성', name: '신주쿠 워싱턴 호텔', notes: '' },
      meal_plan:      '조식',
      transportation: '전세버스',
    },
    checklist_completed: true,
    ai_review: {
      score: 72,
      issues: ['가이드비 20만원이 불포함 — 실질 총액은 A사보다 높음'],
      suggestions: ['가이드비 포함 여부를 명확히 표기하세요.'],
      fact_check: ['판매가 2100만원이지만 가이드비 제외 시 실질 2220만원'],
    },
    rank: 2,
    status: 'approved',
    submitted_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
];

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    const proposals = MOCK_PROPOSALS.filter(p => p.rfq_id === rfqId || rfqId.startsWith('mock'));
    return NextResponse.json({ proposals, count: proposals.length, mock: true });
  }

  try {
    const proposals = await getRfqProposals(rfqId);
    return NextResponse.json({ proposals, count: proposals.length });
  } catch (error) {
    console.error('제안서 목록 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '제안서 목록 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}
