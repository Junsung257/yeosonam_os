import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getGroupRfq,
  getRfqProposals,
} from '@/lib/supabase';

// ── 계약서 HTML 생성기 ───────────────────────────────────────────────────────
function generateContractHtml(params: {
  rfq_code: string;
  destination: string;
  adult_count: number;
  child_count: number;
  duration_nights?: number | null;
  hotel_grade?: string | null;
  meal_plan?: string | null;
  transportation?: string | null;
  special_requests?: string | null;
  total_selling_price: number;
  inclusions: string[];
  exclusions: string[];
  contract_date: string;
}): string {
  const fmt = (n: number) => n.toLocaleString('ko-KR');
  const pax = params.adult_count + params.child_count;

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Noto Sans KR', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #1a1a1a; }
  h1 { text-align: center; font-size: 22px; font-weight: bold; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #555; font-size: 13px; margin-bottom: 32px; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 15px; font-weight: 700; border-bottom: 2px solid #4f46e5; padding-bottom: 6px; margin-bottom: 12px; color: #4f46e5; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 8px 12px; border: 1px solid #ddd; }
  td:first-child { background: #f9fafb; font-weight: 600; width: 30%; }
  .highlight { background: #eef2ff; font-size: 16px; font-weight: bold; text-align: center; padding: 12px; border-radius: 8px; border: 1px solid #c7d2fe; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; margin: 2px; }
  .tag-green { background: #d1fae5; color: #065f46; }
  .tag-red { background: #fee2e2; color: #991b1b; }
  .clause { font-size: 12px; color: #555; line-height: 1.8; }
  .sign-area { display: flex; justify-content: space-between; margin-top: 40px; }
  .sign-box { border-top: 1px solid #999; padding-top: 8px; width: 200px; text-align: center; font-size: 12px; color: #555; }
  .escrow-box { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px 16px; font-size: 12px; color: #92400e; }
</style>
</head>
<body>
<h1>단체여행 표준 계약서</h1>
<p class="subtitle">여소남 여행 플랫폼 · 계약번호: ${params.rfq_code} · 계약일: ${params.contract_date}</p>

<div class="section">
  <div class="section-title">제1조 여행 개요</div>
  <table>
    <tr><td>목적지</td><td>${params.destination}</td></tr>
    <tr><td>여행 인원</td><td>성인 ${params.adult_count}명 / 아동 ${params.child_count}명 (총 ${pax}명)</td></tr>
    <tr><td>여행 기간</td><td>${params.duration_nights ? `${params.duration_nights}박 ${params.duration_nights + 1}일` : '협의 후 확정'}</td></tr>
    <tr><td>숙박 등급</td><td>${params.hotel_grade || '협의 후 확정'}</td></tr>
    <tr><td>식사</td><td>${params.meal_plan || '협의 후 확정'}</td></tr>
    <tr><td>교통</td><td>${params.transportation || '협의 후 확정'}</td></tr>
    ${params.special_requests ? `<tr><td>특별 요청</td><td>${params.special_requests}</td></tr>` : ''}
  </table>
</div>

<div class="section">
  <div class="section-title">제2조 계약 금액</div>
  <div class="highlight">총 판매가: ₩${fmt(params.total_selling_price)}</div>
  <p style="font-size:12px;color:#555;margin-top:8px;text-align:center;">
    위 금액은 최종 확정 판매가이며, 에스크로 결제 후 여행 완료 시 정산됩니다.
  </p>
</div>

<div class="section">
  <div class="section-title">제3조 포함·불포함 내역</div>
  <table>
    <tr>
      <td>포함 항목</td>
      <td>
        ${params.inclusions.length > 0
          ? params.inclusions.map(i => `<span class="tag tag-green">✓ ${i}</span>`).join('')
          : '<span style="color:#999">별도 안내</span>'}
      </td>
    </tr>
    <tr>
      <td>불포함 항목</td>
      <td>
        ${params.exclusions.length > 0
          ? params.exclusions.map(e => `<span class="tag tag-red">✗ ${e}</span>`).join('')
          : '<span style="color:#555">없음 (전포함)</span>'}
      </td>
    </tr>
  </table>
</div>

<div class="section">
  <div class="section-title">제4조 결제 및 에스크로</div>
  <div class="escrow-box">
    💳 <strong>에스크로 결제 안내</strong><br>
    고객이 결제한 대금은 여소남 플랫폼이 에스크로로 보관하며,
    여행 완료 후 랜드사에 확정 원가를 정산합니다.
    여행 취소 시 환불 정책에 따라 처리됩니다.
  </div>
</div>

<div class="section">
  <div class="section-title">제5조 의무 및 책임</div>
  <div class="clause">
    1. <strong>플랫폼(여소남)</strong>: 고객과 랜드사 간 모든 소통을 AI를 통해 중개하며, 계약 이행을 감독합니다.<br>
    2. <strong>랜드사</strong>: 본 계약서에 명시된 일정, 숙박, 식사, 교통을 성실히 이행할 의무가 있습니다.<br>
    3. <strong>고객</strong>: 확정된 여행 대금을 기한 내 납부하여야 하며, 단체 규정을 준수합니다.<br>
    4. <strong>직거래 금지</strong>: 플랫폼 외부에서의 직거래는 계약 위반으로 페널티가 부과됩니다.<br>
    5. <strong>AI 중개 동의</strong>: 모든 소통은 AI가 번역·정제하며, 개인정보 보호 정책에 동의합니다.
  </div>
</div>

<div class="section">
  <div class="section-title">제6조 취소 및 환불 정책</div>
  <div class="clause">
    여행 출발일 기준: 30일 전 취소 → 100% 환불 / 14일 전 취소 → 50% 환불 /
    7일 전 취소 → 30% 환불 / 7일 미만 취소 → 환불 불가.
    랜드사 귀책 사유로 여행이 취소된 경우 전액 환불 및 위약금이 부과됩니다.
  </div>
</div>

<div class="sign-area">
  <div class="sign-box">
    고객 서명<br><br><br>
    (서명 또는 날인)
  </div>
  <div class="sign-box">
    여소남 플랫폼<br><br><br>
    (대표자 직인)
  </div>
  <div class="sign-box">
    랜드사 확인<br><br><br>
    (익명 처리)
  </div>
</div>

</body>
</html>
  `.trim();
}

// ── GET: 계약서 조회 ─────────────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: rfqId } = params;

  if (!isSupabaseConfigured) {
    const mockHtml = generateContractHtml({
      rfq_code:           'GRP-1001',
      destination:        '일본 도쿄',
      adult_count:        20,
      child_count:        5,
      duration_nights:    4,
      hotel_grade:        '4성',
      meal_plan:          '전식포함',
      transportation:     '전세버스',
      special_requests:   '어린이 동반, 유아 카시트 필요',
      total_selling_price: 24000000,
      inclusions:         ['항공', '숙박(4성)', '전 식사', '전세버스'],
      exclusions:         ['개인 음료', '쇼핑'],
      contract_date:      new Date().toISOString().slice(0, 10),
    });
    return NextResponse.json({ contract_html: mockHtml, mock: true });
  }

  try {
    const rfq = await getGroupRfq(rfqId);
    if (!rfq) {
      return NextResponse.json({ error: 'RFQ를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (rfq.status !== 'contracted' && rfq.status !== 'completed') {
      return NextResponse.json(
        { error: '계약이 완료된 RFQ만 계약서를 발급할 수 있습니다.' },
        { status: 409 }
      );
    }

    const proposals = await getRfqProposals(rfqId);
    const selected = proposals.find(p => p.id === rfq.selected_proposal_id);

    const checklist = (selected?.checklist ?? {}) as {
      inclusions?: string[];
      exclusions?: string[];
    };

    const contractHtml = generateContractHtml({
      rfq_code:           rfq.rfq_code,
      destination:        rfq.destination,
      adult_count:        rfq.adult_count,
      child_count:        rfq.child_count ?? 0,
      duration_nights:    rfq.duration_nights,
      hotel_grade:        rfq.hotel_grade,
      meal_plan:          rfq.meal_plan,
      transportation:     rfq.transportation,
      special_requests:   rfq.special_requests,
      total_selling_price: selected?.total_selling_price ?? 0,
      inclusions:         checklist.inclusions ?? [],
      exclusions:         checklist.exclusions ?? [],
      contract_date:      new Date().toISOString().slice(0, 10),
    });

    return NextResponse.json({ contract_html: contractHtml });
  } catch (error) {
    console.error('계약서 생성 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '계약서 생성에 실패했습니다.' },
      { status: 500 }
    );
  }
}
