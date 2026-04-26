import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// GET /api/settlements/[id]/pdf — 정산 내역서 HTML (인쇄/PDF 변환용)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const { id } = params;

  // 정산 + 어필리에이트 조회
  const { data: settlement, error } = await supabaseAdmin
    .from('settlements')
    .select('*, affiliates(name, phone, referral_code, payout_type, encrypted_bank_info, commission_rate)')
    .eq('id', id)
    .single();

  if (error || !settlement) {
    return NextResponse.json({ error: '정산을 찾을 수 없습니다.' }, { status: 404 });
  }

  const aff = settlement.affiliates as any;
  const [year, month] = settlement.settlement_period.split('-');

  // 해당 정산 기간의 귀속 예약 조회
  const periodStart = `${year}-${month}-01`;
  const periodEnd = new Date(+year, +month, 0).toISOString().split('T')[0];

  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, package_title, adult_count, adult_price, child_count, child_price, influencer_commission, applied_total_commission_rate, commission_breakdown, return_date, departure_date, dispute_flag')
    .eq('affiliate_id', settlement.affiliate_id)
    .in('status', ['confirmed', 'completed'])
    .gte('departure_date', periodStart)
    .lte('departure_date', periodEnd)
    .or('is_deleted.is.null,is_deleted.eq.false')
    .order('departure_date', { ascending: true });

  const qualifiedBookings = (bookings || []).filter((b: any) => !b.dispute_flag);

  // 커미션 분해 합계 (스냅샷 기반)
  const breakdownTotals = qualifiedBookings.reduce(
    (acc: { base: number; tier: number; campaigns: number; capped: number }, b: any) => {
      const bd = b.commission_breakdown as
        | { base?: number; tier?: number; campaigns?: { rate?: number }[]; capped?: boolean }
        | null;
      const base = (b.adult_count || 0) * (b.adult_price || 0) + (b.child_count || 0) * (b.child_price || 0);
      if (bd && typeof bd.base === 'number') {
        acc.base += Math.round(base * bd.base);
        acc.tier += Math.round(base * (bd.tier || 0));
        const camp = (bd.campaigns || []).reduce((s: number, c) => s + (c.rate || 0), 0);
        acc.campaigns += Math.round(base * camp);
        if (bd.capped) acc.capped += 1;
      } else {
        // 스냅샷 없는 레거시 예약: 모두 base로 분류
        acc.base += b.influencer_commission || 0;
      }
      return acc;
    },
    { base: 0, tier: 0, campaigns: 0, capped: 0 },
  );

  // HTML 생성
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>정산 내역서 — ${aff.name} ${year}년 ${month}월</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif; padding: 40px; color: #1a1a1a; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 14px; font-weight: 700; color: #333; margin-bottom: 8px; border-bottom: 2px solid #001f3f; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #f3f4f6; text-align: left; padding: 8px 10px; border-bottom: 1px solid #d1d5db; font-weight: 600; }
    td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
    .right { text-align: right; }
    .total-row { background: #eef2ff; font-weight: 700; }
    .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
    .summary-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
    .summary-label { font-size: 11px; color: #666; }
    .summary-value { font-size: 18px; font-weight: 700; color: #001f3f; margin-top: 2px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #999; text-align: center; }
  </style>
</head>
<body>
  <h1>여소남 어필리에이트 정산 내역서</h1>
  <p class="subtitle">정산 기간: ${year}년 ${+month}월 | 파트너: ${aff.name} (${aff.referral_code})</p>

  <div class="section">
    <div class="section-title">파트너 정보</div>
    <table>
      <tr><td style="width:100px;color:#666;">파트너명</td><td>${aff.name}</td><td style="width:100px;color:#666;">연락처</td><td>${aff.phone || '-'}</td></tr>
      <tr><td style="color:#666;">추천코드</td><td>${aff.referral_code}</td><td style="color:#666;">정산유형</td><td>${aff.payout_type === 'PERSONAL' ? '개인 (원천세 3.3%)' : '사업자'}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">귀속 예약 목록 (${qualifiedBookings.length}건)</div>
    <table>
      <thead>
        <tr>
          <th>상품명</th>
          <th class="right">인원</th>
          <th class="right">기준금액</th>
          <th class="right">커미션</th>
          <th>출발일</th>
          <th>귀국일</th>
        </tr>
      </thead>
      <tbody>
        ${qualifiedBookings.map((b: any) => {
          const base = (b.adult_count || 0) * (b.adult_price || 0) + (b.child_count || 0) * (b.child_price || 0);
          return `<tr>
            <td>${b.package_title || '-'}</td>
            <td class="right">${(b.adult_count || 0) + (b.child_count || 0)}명</td>
            <td class="right">${base.toLocaleString()}원</td>
            <td class="right">${(b.influencer_commission || 0).toLocaleString()}원</td>
            <td>${b.departure_date || '-'}</td>
            <td>${b.return_date || '-'}</td>
          </tr>`;
        }).join('')}
        <tr class="total-row">
          <td colspan="3">합계</td>
          <td class="right">${settlement.total_amount?.toLocaleString()}원</td>
          <td colspan="2"></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">커미션 구성 (가산식 분해)</div>
    <table>
      <thead>
        <tr>
          <th>구분</th>
          <th class="right">합계</th>
          <th>비고</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>상품 기본 커미션</td>
          <td class="right">${breakdownTotals.base.toLocaleString()}원</td>
          <td style="color:#666;font-size:11px;">상품별 고정율 (모든 어필리에이터 동일)</td>
        </tr>
        <tr>
          <td>등급 보너스</td>
          <td class="right">${breakdownTotals.tier.toLocaleString()}원</td>
          <td style="color:#666;font-size:11px;">${aff.name}님 현재 등급 보너스 적용</td>
        </tr>
        <tr>
          <td>캠페인 가산</td>
          <td class="right">${breakdownTotals.campaigns.toLocaleString()}원</td>
          <td style="color:#666;font-size:11px;">${breakdownTotals.capped > 0 ? `⚠️ ${breakdownTotals.capped}건 글로벌 캡 적용` : '활성 캠페인 합산'}</td>
        </tr>
      </tbody>
    </table>
    <p style="font-size:10px;color:#999;margin-top:6px;">* 각 예약은 예약 시점 정책으로 동결 (정책 변경 영향 없음)</p>
  </div>

  <div class="section">
    <div class="section-title">정산 요약</div>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">당월 발생 수수료</div>
        <div class="summary-value">${settlement.total_amount?.toLocaleString()}원</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">전월 이월</div>
        <div class="summary-value">${(settlement.carryover_balance || 0).toLocaleString()}원</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">합계 (세전)</div>
        <div class="summary-value">${settlement.final_total?.toLocaleString()}원</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">${aff.payout_type === 'PERSONAL' ? '원천세 (3.3%)' : '세금계산서 별도'}</div>
        <div class="summary-value">${settlement.tax_deduction?.toLocaleString()}원</div>
      </div>
    </div>
    <div class="summary-grid" style="margin-top:8px;">
      <div class="summary-card" style="grid-column:1/3;background:#001f3f;color:white;border:none;">
        <div class="summary-label" style="color:#8bb8ff;">실지급액</div>
        <div class="summary-value" style="font-size:24px;color:white;">${settlement.final_payout?.toLocaleString()}원</div>
      </div>
    </div>
  </div>

  <div class="footer">
    여소남 | 이 문서는 자동 생성되었습니다. | 발행일: ${new Date().toLocaleDateString('ko-KR')}
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
