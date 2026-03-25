import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  createGroupRfq,
  listGroupRfqs,
  GroupRfq,
} from '@/lib/supabase';

const MOCK_RFQS: GroupRfq[] = [
  {
    id: 'mock-rfq-001',
    rfq_code: 'GRP-1001',
    customer_name: '김철수',
    customer_phone: '010-1234-5678',
    destination: '일본 도쿄',
    adult_count: 20,
    child_count: 5,
    budget_per_person: 1200000,
    total_budget: 30000000,
    hotel_grade: '4성',
    meal_plan: '전식포함',
    transportation: '전세버스',
    special_requests: '어린이 동반, 유아 카시트 필요',
    status: 'published',
    published_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    gold_unlock_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    silver_unlock_at: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(),
    bronze_unlock_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    bid_deadline: new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString(),
    max_proposals: 3,
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'mock-rfq-002',
    rfq_code: 'GRP-1002',
    customer_name: '이영희',
    customer_phone: '010-9876-5432',
    destination: '베트남 다낭',
    adult_count: 30,
    child_count: 0,
    budget_per_person: 800000,
    total_budget: 24000000,
    hotel_grade: '5성',
    meal_plan: '조식',
    transportation: '자유이동',
    special_requests: '기업 워크샵 연계',
    status: 'awaiting_selection',
    published_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    gold_unlock_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    silver_unlock_at: new Date(Date.now() - 25.5 * 60 * 60 * 1000).toISOString(),
    bronze_unlock_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    bid_deadline: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    max_proposals: 3,
    selected_proposal_id: undefined,
    created_at: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
];

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const rfqs = status ? MOCK_RFQS.filter(r => r.status === status) : MOCK_RFQS;
    return NextResponse.json({ rfqs, count: rfqs.length, mock: true });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') ?? undefined;
    const rfqs = await listGroupRfqs(status);
    return NextResponse.json({ rfqs, count: rfqs.length });
  } catch (error) {
    console.error('RFQ 목록 조회 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 목록 조회에 실패했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    const body = await request.json();
    const mockRfq: GroupRfq = {
      id: `mock-rfq-${Date.now()}`,
      rfq_code: `GRP-${Math.floor(Math.random() * 9000) + 1000}`,
      customer_name: body.customer_name ?? '미입력',
      customer_phone: body.customer_phone,
      destination: body.destination ?? '미입력',
      adult_count: body.adult_count ?? 0,
      child_count: body.child_count ?? 0,
      budget_per_person: body.budget_per_person,
      total_budget: body.total_budget,
      hotel_grade: body.hotel_grade,
      meal_plan: body.meal_plan,
      transportation: body.transportation,
      special_requests: body.special_requests,
      custom_requirements: body.custom_requirements,
      ai_interview_log: body.ai_interview_log,
      status: 'draft',
      max_proposals: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return NextResponse.json({ rfq: mockRfq, mock: true }, { status: 201 });
  }

  try {
    const body = await request.json();
    const {
      customer_name,
      customer_phone,
      destination,
      adult_count,
      child_count,
      budget_per_person,
      total_budget,
      hotel_grade,
      meal_plan,
      transportation,
      special_requests,
      custom_requirements,
      ai_interview_log,
    } = body;

    if (!customer_name || !destination || !adult_count) {
      return NextResponse.json(
        { error: '고객명, 목적지, 인원수는 필수입니다.' },
        { status: 400 }
      );
    }

    const rfq = await createGroupRfq({
      customer_name,
      customer_phone,
      destination,
      adult_count,
      child_count: child_count ?? 0,
      budget_per_person,
      total_budget,
      hotel_grade,
      meal_plan,
      transportation,
      special_requests,
      custom_requirements,
      ai_interview_log,
      status: 'draft',
      max_proposals: 3,
    });

    if (!rfq) {
      return NextResponse.json({ error: 'RFQ 생성에 실패했습니다.' }, { status: 500 });
    }

    return NextResponse.json({ rfq }, { status: 201 });
  } catch (error) {
    console.error('RFQ 생성 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 생성에 실패했습니다.' },
      { status: 500 }
    );
  }
}
