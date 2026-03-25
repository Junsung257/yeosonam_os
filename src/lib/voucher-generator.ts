/**
 * 여소남 표준 확정서(Voucher) 자동 생성기
 *
 * 랜드사가 입력한 원시 JSON 데이터를 '여소남 표준 템플릿 데이터 구조'로 매핑하고,
 * 하단에 여행자 보험 + 유심 업셀링 항목을 자동 주입한다.
 *
 * 업셀링 구조: 원가(cost) = 0, 판매가(selling_price) 전액이 여소남 마진
 */

// ── 업셀링 상수 (환경변수로 재정의 가능) ─────────────────────

const UPSELL_ITEMS: UpsellItem[] = [
  {
    id: 'travel_insurance',
    name: '여소남 제휴 여행자 보험',
    description: '해외여행 중 상해·질병·휴대품 손해를 보장하는 맞춤 보험',
    cost: 0,           // 원가 없음 — 전액 마진
    selling_price: 15000, // 1인 기준 예시 (실제 운영 시 환경변수 처리)
    unit: '인',
    link_url: process.env.NEXT_PUBLIC_INSURANCE_URL || 'https://link.yesonam.com/insurance',
    category: 'insurance',
    is_required_upsell: true,
  },
  {
    id: 'usim',
    name: '여소남 제휴 현지 유심',
    description: '목적지 현지 데이터 유심 (무제한 데이터, 공항 수령)',
    cost: 0,           // 원가 없음 — 전액 마진
    selling_price: 12000, // 1인 기준 예시
    unit: '인',
    link_url: process.env.NEXT_PUBLIC_USIM_URL || 'https://link.yesonam.com/usim',
    category: 'usim',
    is_required_upsell: true,
  },
];

// ── 인터페이스 ────────────────────────────────────────────────

/** 랜드사가 제출하는 원시 데이터 (자유 형식) */
export interface RawVoucherInput {
  // 예약/여행 기본 정보
  booking_id?: string;
  rfq_id?: string;
  customer_name: string;
  customer_phone?: string;
  customer_count?: number;    // 총 인원 (성인 + 아동)
  adult_count?: number;
  child_count?: number;
  destination: string;
  departure_date: string;     // ISO 날짜 문자열
  end_date: string;           // ISO 날짜 문자열
  duration_nights?: number;

  // 상품 정보
  product_title?: string;
  land_agency_name?: string;
  land_agency_contact?: string; // 내부 전용, 확정서에 미노출

  // 비용 (원가/판매가 분리)
  total_cost: number;          // 원가 (랜드사 수취액)
  total_selling_price: number; // 판매가 (고객 결제액)

  // 일정
  itinerary?: RawItineraryDay[];

  // 숙소
  accommodations?: RawAccommodation[];

  // 포함/불포함 사항
  inclusions?: string[];
  exclusions?: string[];

  // 집결지/이동
  meeting_point?: string;
  meeting_time?: string;
  transportation?: string;

  // 항공
  flight_info?: string;

  // 기타 메모
  notes?: string;
  special_requests?: string;

  // 추가 자유 필드 (랜드사별 커스텀)
  extra?: Record<string, unknown>;
}

interface RawItineraryDay {
  day: number;
  date?: string;
  title?: string;
  description?: string;
  meals?: string;           // '조식/중식/석식' 자유 표기
  hotel?: string;
}

interface RawAccommodation {
  night_from: number;
  night_to: number;
  hotel_name: string;
  grade?: string;           // '5성', '4성' 등
  room_type?: string;
  check_in?: string;
  check_out?: string;
}

/** 여소남 표준 확정서 데이터 구조 */
export interface VoucherData {
  // ── 메타 ──────────────────────────────────────────────────
  voucher_version: string;   // '1.0'
  generated_at: string;      // ISO timestamp
  platform: '여소남';

  // ── 예약 정보 ─────────────────────────────────────────────
  booking_ref: string;       // booking_id 또는 rfq_id
  customer: {
    name: string;
    count: number;
    adult_count: number;
    child_count: number;
  };

  // ── 여행 기본 정보 ────────────────────────────────────────
  travel: {
    destination: string;
    product_title: string;
    departure_date: string;
    end_date: string;
    duration_nights: number;
    transportation: string;
    flight_info: string;
    meeting_point: string;
    meeting_time: string;
  };

  // ── 비용 (고객 노출용: 판매가만, 원가 미노출) ──────────────
  pricing: {
    total_selling_price: number;  // 고객 결제액
    per_person_price: number;     // 1인당 판매가
    // total_cost는 내부 전용 — 확정서 PDF에 미포함
  };

  // ── 일정표 ───────────────────────────────────────────────
  itinerary: ItineraryDay[];

  // ── 숙소 ─────────────────────────────────────────────────
  accommodations: Accommodation[];

  // ── 포함/불포함 ───────────────────────────────────────────
  inclusions: string[];
  exclusions: string[];

  // ── 메모 ─────────────────────────────────────────────────
  notes: string;
  special_requests: string;

  // ── 여소남 안심 안내 ──────────────────────────────────────
  platform_notice: string;

  // ── 업셀링 항목 (자동 주입) ───────────────────────────────
  upsell: UpsellItem[];

  // ── 랜드사 명 (익명화: 고객에게는 "담당 랜드사"로 표시) ────
  land_agency_display: string;
}

interface ItineraryDay {
  day: number;
  date: string;
  title: string;
  description: string;
  meals: string;
  hotel: string;
}

interface Accommodation {
  nights: string;      // 예: "1~3박"
  hotel_name: string;
  grade: string;
  room_type: string;
  check_in: string;
  check_out: string;
}

export interface UpsellItem {
  id: string;
  name: string;
  description: string;
  cost: number;           // 항상 0 — 전액 마진
  selling_price: number;  // 고객 결제 금액
  unit: string;
  link_url: string;
  category: 'insurance' | 'usim' | 'etc';
  is_required_upsell: boolean;
}

// ── 핵심 매핑 함수 ────────────────────────────────────────────

/**
 * 랜드사 원시 데이터 → 여소남 표준 확정서 데이터 구조로 변환.
 * 하단에 업셀링 항목(보험 + 유심)을 자동 주입한다.
 */
export function generateVoucherData(raw: RawVoucherInput): VoucherData {
  const adultCount = raw.adult_count ?? raw.customer_count ?? 1;
  const childCount = raw.child_count ?? 0;
  const totalCount = adultCount + childCount;

  // 인원수 기반 업셀링 단가 계산 (성인 기준)
  const upsellWithCount: UpsellItem[] = UPSELL_ITEMS.map((item) => ({
    ...item,
    // 링크에 UTM + 인원 파라미터 자동 추가
    link_url: `${item.link_url}?count=${adultCount}&utm_source=voucher&utm_medium=alimtalk&utm_campaign=${item.category}`,
  }));

  return {
    // ── 메타
    voucher_version: '1.0',
    generated_at: new Date().toISOString(),
    platform: '여소남',

    // ── 예약 정보
    booking_ref: raw.booking_id ?? raw.rfq_id ?? 'N/A',
    customer: {
      name: raw.customer_name,
      count: totalCount,
      adult_count: adultCount,
      child_count: childCount,
    },

    // ── 여행 기본 정보
    travel: {
      destination: raw.destination,
      product_title: raw.product_title || `${raw.destination} 여행`,
      departure_date: raw.departure_date,
      end_date: raw.end_date,
      duration_nights: raw.duration_nights ?? calcNights(raw.departure_date, raw.end_date),
      transportation: raw.transportation || '항공',
      flight_info: raw.flight_info || '별도 안내',
      meeting_point: raw.meeting_point || '공항 미팅 (별도 안내)',
      meeting_time: raw.meeting_time || '별도 안내',
    },

    // ── 비용 (고객 노출용: 판매가만)
    pricing: {
      total_selling_price: raw.total_selling_price,
      per_person_price: totalCount > 0
        ? Math.round(raw.total_selling_price / totalCount)
        : raw.total_selling_price,
    },

    // ── 일정표 매핑
    itinerary: mapItinerary(raw.itinerary ?? [], raw.departure_date),

    // ── 숙소 매핑
    accommodations: mapAccommodations(raw.accommodations ?? []),

    // ── 포함/불포함
    inclusions: raw.inclusions ?? [],
    exclusions: [
      ...(raw.exclusions ?? []),
      // 업셀링 항목은 불포함 안내로 자동 추가
      '여행자 보험 (여소남 제휴 보험 별도 구매 가능)',
      '현지 유심 (여소남 제휴 유심 별도 구매 가능)',
    ],

    // ── 메모
    notes: raw.notes || '',
    special_requests: raw.special_requests || '',

    // ── 여소남 안심 안내 문구
    platform_notice: [
      '본 확정서는 여소남 플랫폼을 통해 자동 발급되었습니다.',
      '랜드사와의 직거래 또는 직접 연락은 여소남 안심 보장 서비스에서 제외됩니다.',
      '문의: 여소남 고객센터 (플랫폼 채팅 이용)',
    ].join('\n'),

    // ── 랜드사 익명화 (고객에게 직접 노출 안 함)
    land_agency_display: '담당 랜드사',

    // ── 업셀링 항목 자동 주입 (원가=0, 판매가 전액 마진)
    upsell: upsellWithCount,
  };
}

// ── 내부 유틸 ─────────────────────────────────────────────────

function calcNights(departure: string, end: string): number {
  try {
    const diff = new Date(end).getTime() - new Date(departure).getTime();
    return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
  } catch {
    return 0;
  }
}

function mapItinerary(raw: RawItineraryDay[], departureDate: string): ItineraryDay[] {
  return raw.map((d) => {
    // 날짜 자동 계산 (제공 없으면 출발일 + day-1)
    let dateStr = d.date || '';
    if (!dateStr && departureDate) {
      try {
        const dt = new Date(departureDate);
        dt.setDate(dt.getDate() + (d.day - 1));
        dateStr = dt.toISOString().slice(0, 10);
      } catch {
        dateStr = '';
      }
    }
    return {
      day: d.day,
      date: dateStr,
      title: d.title || `Day ${d.day}`,
      description: d.description || '',
      meals: d.meals || '미포함',
      hotel: d.hotel || '',
    };
  });
}

function mapAccommodations(raw: RawAccommodation[]): Accommodation[] {
  return raw.map((a) => ({
    nights: `${a.night_from}~${a.night_to}박`,
    hotel_name: a.hotel_name,
    grade: a.grade || '미정',
    room_type: a.room_type || '트윈/더블',
    check_in: a.check_in || '오후 3시',
    check_out: a.check_out || '오전 11시',
  }));
}

/**
 * 확정서 데이터를 간단한 HTML 문자열로 렌더링 (PDF 생성 또는 알림톡 첨부용).
 * 실제 PDF 변환은 서버에서 puppeteer 또는 Supabase Edge Function으로 처리.
 */
export function renderVoucherHtml(data: VoucherData): string {
  const fmt = (n: number) => n.toLocaleString('ko-KR');
  const itineraryRows = data.itinerary
    .map(
      (d) => `
      <tr>
        <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;white-space:nowrap;">
          Day ${d.day}<br><small style="color:#6b7280;">${d.date}</small>
        </td>
        <td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">${d.title}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;color:#374151;">${d.description}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;text-align:center;">${d.meals}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;">${d.hotel}</td>
      </tr>`
    )
    .join('');

  const upsellCards = data.upsell
    .map(
      (u) => `
      <div style="border:1px solid #6366f1;border-radius:8px;padding:12px 16px;margin-bottom:8px;background:#f5f3ff;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong style="color:#4f46e5;">${u.name}</strong>
            <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${u.description}</p>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px;color:#9ca3af;">원가 0원 (전액 마진)</div>
            <div style="font-size:16px;font-weight:700;color:#4f46e5;">₩${fmt(u.selling_price)} / ${u.unit}</div>
            <a href="${u.link_url}" style="display:inline-block;margin-top:4px;padding:4px 10px;background:#4f46e5;color:#fff;border-radius:4px;font-size:12px;text-decoration:none;">구매하기 →</a>
          </div>
        </div>
      </div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>여소남 표준 확정서</title>
  <style>
    body { font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; font-size: 14px; color: #111827; margin: 0; padding: 0; }
    .container { max-width: 800px; margin: 0 auto; padding: 32px; }
    .header { text-align: center; padding-bottom: 24px; border-bottom: 2px solid #4f46e5; margin-bottom: 24px; }
    .badge { display: inline-block; background: #4f46e5; color: #fff; font-size: 11px; padding: 3px 8px; border-radius: 4px; margin-bottom: 8px; }
    h1 { font-size: 22px; margin: 0; color: #111827; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 15px; font-weight: 700; color: #4f46e5; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 12px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
    .info-row { display: flex; gap: 8px; }
    .info-label { color: #6b7280; min-width: 80px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f9fafb; padding: 8px; border: 1px solid #e5e7eb; text-align: left; font-size: 12px; color: #6b7280; }
    .notice { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #92400e; white-space: pre-line; }
    .upsell-header { background: #f5f3ff; border: 1px solid #c4b5fd; border-radius: 8px; padding: 10px 16px; margin-bottom: 12px; }
    .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
<div class="container">

  <div class="header">
    <div class="badge">여소남 공식 확정서</div>
    <h1>✈ ${data.travel.product_title}</h1>
    <p style="color:#6b7280;margin:4px 0 0;">발급일: ${data.generated_at.slice(0, 10)} &nbsp;|&nbsp; 예약번호: ${data.booking_ref}</p>
  </div>

  <div class="section">
    <h2>예약자 정보</h2>
    <div class="info-grid">
      <div class="info-row"><span class="info-label">예약자</span><strong>${data.customer.name}</strong></div>
      <div class="info-row"><span class="info-label">인원</span>${data.customer.count}명 (성인 ${data.customer.adult_count} / 아동 ${data.customer.child_count})</div>
    </div>
  </div>

  <div class="section">
    <h2>여행 정보</h2>
    <div class="info-grid">
      <div class="info-row"><span class="info-label">목적지</span><strong>${data.travel.destination}</strong></div>
      <div class="info-row"><span class="info-label">여행기간</span>${data.travel.departure_date} ~ ${data.travel.end_date} (${data.travel.duration_nights}박)</div>
      <div class="info-row"><span class="info-label">이동수단</span>${data.travel.transportation}</div>
      <div class="info-row"><span class="info-label">항공정보</span>${data.travel.flight_info}</div>
      <div class="info-row"><span class="info-label">집결장소</span>${data.travel.meeting_point}</div>
      <div class="info-row"><span class="info-label">집결시간</span>${data.travel.meeting_time}</div>
    </div>
  </div>

  <div class="section">
    <h2>결제 금액</h2>
    <div class="info-row" style="gap:16px;font-size:18px;">
      <span class="info-label">총 판매가</span>
      <strong style="color:#4f46e5;">₩${fmt(data.pricing.total_selling_price)}</strong>
      <span style="font-size:13px;color:#6b7280;">(1인 ₩${fmt(data.pricing.per_person_price)})</span>
    </div>
  </div>

  ${data.itinerary.length > 0 ? `
  <div class="section">
    <h2>여행 일정</h2>
    <table>
      <thead>
        <tr>
          <th style="width:80px;">일자</th>
          <th style="width:140px;">제목</th>
          <th>일정 내용</th>
          <th style="width:80px;">식사</th>
          <th style="width:120px;">숙소</th>
        </tr>
      </thead>
      <tbody>${itineraryRows}</tbody>
    </table>
  </div>` : ''}

  ${data.inclusions.length > 0 || data.exclusions.length > 0 ? `
  <div class="section">
    <h2>포함 / 불포함 사항</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <h3 style="font-size:13px;color:#059669;margin:0 0 8px;">✅ 포함</h3>
        <ul style="margin:0;padding-left:16px;font-size:13px;">${data.inclusions.map((i) => `<li>${i}</li>`).join('')}</ul>
      </div>
      <div>
        <h3 style="font-size:13px;color:#ef4444;margin:0 0 8px;">❌ 불포함</h3>
        <ul style="margin:0;padding-left:16px;font-size:13px;">${data.exclusions.map((e) => `<li>${e}</li>`).join('')}</ul>
      </div>
    </div>
  </div>` : ''}

  <div class="section">
    <h2>💜 여소남 제휴 추천 서비스</h2>
    <div class="upsell-header">
      <p style="margin:0;font-size:13px;color:#6b7280;">아래 서비스를 함께 준비하면 더욱 안심하고 여행하실 수 있습니다.</p>
    </div>
    ${upsellCards}
  </div>

  <div class="section">
    <h2>안내 사항</h2>
    <div class="notice">${data.platform_notice}</div>
    ${data.notes ? `<p style="font-size:13px;color:#374151;margin-top:12px;">${data.notes}</p>` : ''}
  </div>

  <div class="footer">
    여소남 | 본 확정서는 전자 문서로 효력을 가집니다. | 발급: ${data.generated_at.slice(0, 10)}
  </div>

</div>
</body>
</html>`;
}
