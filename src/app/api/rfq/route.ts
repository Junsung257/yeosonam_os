import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  createGroupRfq,
  listGroupRfqs,
  GroupRfq,
} from '@/lib/supabase';
import { findOrCreateCustomerByPhone } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import { isAdminRequest } from '@/lib/admin-guard';
import { maskPhoneForLog, redactNameForLog } from '@/lib/pii-mask';

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
  // Admin 전용: 관리자 인증 필요
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const rfqs = status ? MOCK_RFQS.filter(r => r.status === status) : MOCK_RFQS;
    return NextResponse.json({ rfqs, count: rfqs.length, mock: true }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') ?? undefined;
    const rfqs = await listGroupRfqs(status);
    return NextResponse.json({ rfqs, count: rfqs.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('RFQ 목록 조회 오류:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'RFQ 목록 조회에 실패했습니다.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
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
      departure_date_from,
      departure_date_to,
      duration_nights,
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

    // 전화번호로 고객 조회/생성 → customer_id 연결 (Travel Passport 연동)
    let customerId: string | null = null;
    if (customer_phone) {
      customerId = await findOrCreateCustomerByPhone(customer_phone, customer_name);
    }

    const rfq = await createGroupRfq({
      customer_id: customerId ?? undefined,
      customer_name,
      customer_phone,
      destination,
      departure_date_from,
      departure_date_to,
      duration_nights,
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

    // 🔔 단체/단독맞춤 랜딩 문의 → 내부 Slack 알림 (best-effort, 실패해도 응답엔 영향 없음)
    const cr = (custom_requirements ?? {}) as Record<string, unknown>;
    const source = cr.source as string | undefined;
    if (source === 'group_landing' || source === 'private_tour_landing') {
      try {
        const slackUrl = getSecret('SLACK_GROUP_RFQ_WEBHOOK_URL');
        if (slackUrl) {
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://yeosonam.com';
          const emoji = source === 'private_tour_landing' ? '✈️' : '🎯';
          const title = source === 'private_tour_landing' ? '단독맞춤여행 신규 문의' : '단체여행 신규 문의';
          const customerEmail = cr.customer_email as string | undefined;
          const shareToken = (rfq as unknown as Record<string, unknown>).share_token as string | undefined;
          const shareUrl = shareToken ? `${baseUrl}/share/rfq/${shareToken}` : null;
          const lines = [
            `${emoji} *${title}*`,
            `• 신청자: ${customer_name} (${customer_phone ?? '-'})`,
            customerEmail ? `• 이메일: ${customerEmail}` : null,
            `• 유형: ${cr.group_type ?? cr.group_name ?? '-'}`,
            `• 목적지: ${destination} / ${adult_count}명 / ${cr.budget_range_label ?? '-'}`,
            `• 희망 출발: ${departure_date_from ?? '-'}`,
            `• 호텔: ${hotel_grade ?? '-'}`,
            `• RFQ: ${baseUrl}/rfq/${rfq.id}`,
            shareUrl ? `• 공유 링크: ${shareUrl}` : null,
          ].filter(Boolean);
          const utm = cr.utm as Record<string, string | null> | undefined;
          if (utm && (utm.source || utm.n_keyword)) {
            lines.push(`• 유입: ${utm.source ?? '-'} / kw: ${utm.n_keyword ?? '-'}`);
          }
          await fetch(slackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: lines.join('\n') }),
          });
        }
      } catch (e) {
        console.error(`[${source} Slack 알림 실패, 무시]:`, e);
      }
    }

    // share_token이 생성되었으면 share_url 포함
    const shareUrl = (rfq as unknown as Record<string, unknown>).share_token
      ? `${process.env.NEXT_PUBLIC_BASE_URL ?? 'https://yeosonam.com'}/share/rfq/${(rfq as unknown as Record<string, unknown>).share_token}`
      : null;

    // 🔔 고객 알림: best-effort — Solapi 알림톡 또는 push 알림
    tryNotifyCustomer(customer_phone, customer_name, destination, adult_count, shareUrl).catch(() => {});

    return NextResponse.json({ rfq, share_token: (rfq as unknown as Record<string, unknown>).share_token ?? null, share_url: shareUrl }, { status: 201 });
  } catch (error) {
    console.error('RFQ 생성 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'RFQ 생성에 실패했습니다.' },
      { status: 500 }
    );
  }
}

// ── 고객 알림 (견적 접수 완료) ─────────────────────────────
async function tryNotifyCustomer(
  phone: string | undefined | null,
  name: string,
  destination: string,
  pax: number,
  shareUrl: string | null,
) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://yeosonam.com';

  // 1. Slack 알림 (운영자가 즉시 확인)
  const slackUrl = getSecret('SLACK_GROUP_RFQ_WEBHOOK_URL');
  if (slackUrl) {
    try {
      await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `📬 *견적 접수 완료 (고객 알림 발송)*\n• 고객: ${name} (${phone ?? '-'})\n• 목적지: ${destination} / ${pax}명\n• 공유: ${shareUrl ?? '-'}\n• 대시보드: ${baseUrl}/admin/rfqs`,
        }),
      });
    } catch { /* 무시 */ }
  }

  // 2. 고객 push 알림 (웹 푸시 구독자)
  try {
    const { dispatchPush } = await import('@/lib/push-dispatcher');
    await dispatchPush({
      title: '✈️ 견적 요청 완료!',
      body: `${name}님의 ${destination} 여행 견적이 접수되었습니다. 24시간 내로 맞춤 제안을 보내드립니다.`,
      deepLink: shareUrl ?? `${baseUrl}/rfq/`,
      kind: 'rfq_submitted',
      tag: `rfq_${Date.now()}`,
    });
  } catch { /* 무시 */ }

  // 3. TODO: Solapi 카카오 알림톡 (템플릿 등록 후 활성화)
  //    템플릿: "견적접수완료" — 변수: #{고객명}, #{목적지}, #{인원}, #{공유링크}
  console.log('[고객 알림] 견적 접수', {
    customer: redactNameForLog(name),
    phone: maskPhoneForLog(phone),
    destination,
  });
}
