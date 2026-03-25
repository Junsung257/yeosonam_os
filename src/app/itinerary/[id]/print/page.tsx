import { notFound } from 'next/navigation';
import PrintBar from './PrintBar';
import { createClient } from '@supabase/supabase-js';
import type { TravelItinerary, DaySchedule, MealInfo } from '@/types/itinerary';
import PriceSheetTemplate, { type PriceTier } from '@/components/itinerary/PriceSheetTemplate';

// ── Supabase 서버사이드 클라이언트 ────────────────────────────────────────
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function loadPackage(id: string) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('travel_packages')
    .select('id, title, itinerary_data, price_tiers, excluded_dates')
    .eq('id', id)
    .single();
  return data as { id: string; title: string; itinerary_data: TravelItinerary | null; price_tiers: PriceTier[] | null; excluded_dates: string[] | null } | null;
}

// ── 목 데이터 (DB 연동 전 UI 확인용) ─────────────────────────────────────
const MOCK: TravelItinerary = {
  meta: {
    title: '노팁 노옵션 장가계 3박4일',
    product_type: '노팁노옵션',
    destination: '장가계',
    nights: 3,
    days: 4,
    departure_airport: '부산(김해)',
    airline: '에어부산',
    flight_out: 'BX371',
    flight_in: 'BX372',
    departure_days: '매주 월/화/수/목/금/토/일',
    min_participants: 4,
    room_type: '2인 1실',
    ticketing_deadline: '3/27(금)까지',
    hashtags: ['#질성산', '#리무진차량', '#과일바구니서비스', '#매일특식', '#마사지'],
    brand: '여소남',
  },
  highlights: {
    inclusions: [
      '왕복 항공판매가 (텍스 포함) 및 여행자 보험',
      '전 일정 5성급 호텔, 식사, 전용 차량, 관광지 입장료',
      '푸꾸옥 핵심 투어 (케이블카, 사파리 등) 및 전신마사지',
      '쇼핑 2회 (노니&침향, 커피&잡화)',
    ],
    excludes: [
      '기사/가이드 경비: **1인 $50** (현지 지불)',
      '기타 개인 경비 및 매너 팁',
    ],
    shopping: null,
    remarks: [
      '**여권:** 출발일 기준 유효기간 **6개월 이상** 필수',
      '**입국 서류:** 미성년자 부모 동반 시 영문 가족관계증명서 / 미동반 시 영문 부모 동의서 공증',
      '**일정 안내:** 패키지 일정 미참여 시 1인 1일 **$100 페널티** 발생',
    ],
  },
  days: [
    {
      day: 1, regions: ['부산', '장가계'],
      meals: { breakfast: false, lunch: true, dinner: true, breakfast_note: null, lunch_note: '누룽지백숙', dinner_note: '원탁요리' },
      schedule: [
        { time: '09:00', activity: '부산 출발', transport: 'BX371', note: null, type: 'flight' },
        { time: '11:20', activity: '장가계 도착 / 가이드 미팅 후 중식', transport: '전용차량', note: null, type: 'normal' },
        { time: null, activity: '장가계의 혼이라 불리는 천문산 등정', transport: null, note: '케이블카 상행-에스컬레이터-천문산사-귀곡잔도-유리잔도-천문산동선-케이블카 하행', type: 'normal' },
        { time: null, activity: '장가계의 떠오르는 야경명소 72기루(차창관광)', transport: null, note: null, type: 'normal' },
        { time: null, activity: '호텔투숙', transport: null, note: null, type: 'hotel' },
      ],
      hotel: { name: '장가계 국제호텔', grade: '4성', note: '또는 동급' },
    },
    {
      day: 2, regions: ['장가계'],
      meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '비빔밥', dinner_note: '불고기정식' },
      schedule: [
        { time: null, activity: '호텔 조식 후 천자산 풍경구로 이동', transport: '전용차량', note: '전일', type: 'normal' },
        { time: null, activity: '2KM 케이블카로 천자산 등정 / 봉우리 형상의 어필봉 / 선녀헌화 / 하룡공원', transport: null, note: null, type: 'normal' },
        { time: null, activity: '원가계로 이동 — 천하제일교 / 미혼대 / 후화원 / 백룡엘리베이터(326M)로 하산', transport: null, note: null, type: 'normal' },
        { time: null, activity: '십리화랑(왕복 모노레일) / 금편계곡(도보)', transport: null, note: null, type: 'normal' },
        { time: null, activity: '석식 후 ▶발마사지(50분/매너팁$5) 체험', transport: null, note: '선택관광', type: 'optional' },
        { time: null, activity: '호텔투숙', transport: null, note: null, type: 'hotel' },
      ],
      hotel: { name: '장가계 국제호텔', grade: '4성', note: '또는 동급' },
    },
    {
      day: 3, regions: ['장가계'],
      meals: { breakfast: true, lunch: true, dinner: true, breakfast_note: '호텔식', lunch_note: '버섯전골', dinner_note: '삼겹살 무제한' },
      schedule: [
        { time: null, activity: '호텔 조식 후', transport: '전용차량', note: '전일', type: 'normal' },
        { time: null, activity: '보봉호 유람(VIP통로)', transport: null, note: null, type: 'normal' },
        { time: null, activity: '황룡동굴 — 상하 4종 크기의 대형 석회암동굴', transport: null, note: null, type: 'normal' },
        { time: null, activity: '칠성산 — 7개 봉우리가 북두칠성을 가리킴, 왕복케이블카, 유리전망대', transport: null, note: null, type: 'normal' },
        { time: null, activity: '호텔투숙', transport: null, note: null, type: 'hotel' },
      ],
      hotel: { name: '장가계 국제호텔', grade: '4성', note: '또는 동급' },
    },
    {
      day: 4, regions: ['장가계', '부산'],
      meals: { breakfast: true, lunch: false, dinner: false, breakfast_note: '호텔식', lunch_note: '김밥도시락', dinner_note: null },
      schedule: [
        { time: null, activity: '호텔 조식 후', transport: '전용차량', note: null, type: 'normal' },
        { time: null, activity: '군성사석화박물관 — 돌과 모래로 만든 작품 전시', transport: null, note: null, type: 'normal' },
        { time: '12:20', activity: '장가계 출발', transport: 'BX372', note: null, type: 'flight' },
        { time: '16:35', activity: '부산 도착', transport: null, note: null, type: 'flight' },
      ],
      hotel: null,
    },
  ],
  optional_tours: [
    { name: '발마사지(50분)', price_usd: null, price_krw: null, note: '매너팁$5 별도' },
  ],
};

// ── price_tiers 목 (판매가표용) ────────────────────────────────────────────
const MOCK_PRICE_TIERS: PriceTier[] = [
  { departure_day: '월', departure_dates: ['6'], adult_price: 799000, status: 'available', note: '★최저가' },
  { departure_day: '화', departure_dates: ['7', '14', '21'], adult_price: 869000, status: 'available', note: null },
  { departure_day: '수', departure_dates: ['8', '22'], adult_price: 899000, status: 'available', note: null },
  { departure_day: '목', departure_dates: ['23'], adult_price: 1219000, status: 'available', note: null },
  { departure_day: '금', departure_dates: ['3', '24'], adult_price: 1049000, status: 'available', note: null },
  { departure_day: '토', departure_dates: ['11', '18'], adult_price: 1099000, status: 'available', note: null },
  { departure_day: '일', departure_dates: ['5', '12'], adult_price: 899000, status: 'available', note: null },
];

// ── Bold 마크다운 렌더러 ──────────────────────────────────────────────────
function renderBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-bold">{part}</strong> : part
  );
}

// ── 날짜 유틸 ────────────────────────────────────────────────────────────
const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function formatKoDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}(${DAYS_KO[d.getDay()]})`;
}

// ── 지역 칸 Cross-Day Rowspan 계산 ────────────────────────────────────────
type RegionSpanInfo = { show: boolean; rowspan: number };

function computeRegionSpans(
  days: (DaySchedule & { resolvedDate: string | null })[]
): RegionSpanInfo[] {
  const spans: RegionSpanInfo[] = days.map(() => ({ show: true, rowspan: 0 }));
  let i = 0;
  while (i < days.length) {
    if (days[i].regions.length === 1) {
      const region = days[i].regions[0];
      let j = i + 1;
      while (
        j < days.length &&
        days[j].regions.length === 1 &&
        days[j].regions[0] === region
      ) {
        j++;
      }
      // days i..j-1 모두 같은 단일 지역 → 병합
      const totalRows = days
        .slice(i, j)
        .reduce((sum, d) => sum + d.schedule.length, 0);
      spans[i] = { show: true, rowspan: totalRows };
      for (let k = i + 1; k < j; k++) {
        spans[k] = { show: false, rowspan: 0 };
      }
      i = j;
    } else {
      spans[i] = { show: true, rowspan: days[i].schedule.length };
      i++;
    }
  }
  return spans;
}

// ── 식사 셀 렌더러 ─────────────────────────────────────────────────────────
function MealCell({ meals }: { meals: MealInfo }) {
  const items = [
    { label: '조', included: meals.breakfast, note: meals.breakfast_note },
    { label: '중', included: meals.lunch, note: meals.lunch_note },
    { label: '석', included: meals.dinner, note: meals.dinner_note },
  ];

  return (
    <>
      {items.map(({ label, included, note }) => {
        if (!included) {
          return (
            <div key={label} style={{ color: '#d1d5db', fontSize: '10px', lineHeight: '1.6' }}>
              {label}: X
            </div>
          );
        }
        const displayNote = note || (label === '조' ? '호텔식' : '현지식');
        const isSpecial =
          note &&
          (note.includes('무제한') ||
            note.includes('특식') ||
            note.includes('삼겹살') ||
            note.includes('랍스터') ||
            note.includes('샤부'));
        return (
          <div
            key={label}
            style={{
              fontSize: '10px',
              lineHeight: '1.6',
              color: isSpecial ? '#ea580c' : '#374151',
              fontWeight: isSpecial ? 'bold' : 'normal',
            }}
          >
            {label}: {displayNote}
          </div>
        );
      })}
    </>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────
export default async function PrintPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { mode?: string; date?: string };
}) {
  const mode = (searchParams.mode || 'detail') as 'summary' | 'detail';
  const departureDate = searchParams.date || null; // e.g. "2026-04-05"

  // DB에서 실제 데이터 로드
  const pkg = await loadPackage(params.id);
  // itinerary_data가 없을 때만 MOCK 사용, days만 없으면 빈 배열로 처리 (meta/highlights는 실제 데이터 유지)
  const rawItinerary = pkg?.itinerary_data;
  const itinerary: TravelItinerary = rawItinerary
    ? { ...rawItinerary, days: rawItinerary.days ?? [] }
    : MOCK;
  const hasItinerary = (itinerary.days?.length ?? 0) > 0;
  const priceTiers = pkg?.price_tiers ?? MOCK_PRICE_TIERS;
  const excludedDates: string[] = pkg?.excluded_dates ?? [];

  // 날짜 지정 시 해당 가격 찾기
  let confirmedPrice: number | null = null;
  if (departureDate) {
    const day = new Date(departureDate).getDate().toString();
    const tier = priceTiers.find(t => (t.departure_dates ?? []).includes(day));
    confirmedPrice = tier?.adult_price ?? null;
  }

  // 각 day에 실제 날짜 계산 (days가 없어도 안전하게 처리)
  const daysWithDates = (itinerary.days ?? []).map((d, i) => ({
    ...d,
    resolvedDate: departureDate ? addDays(departureDate, i) : null,
  }));

  return (
    <>
      {/* 화면 전용 컨트롤 바 */}
      <PrintBar title={itinerary.meta.title} />

      {/* 화면: 회색 배경 + 중앙 정렬 / 인쇄: 흰 배경 */}
      <div
        className="print:bg-white bg-gray-300 min-h-screen print:min-h-0 flex flex-col items-center py-8 print:py-0 gap-6 print:gap-0"
        style={{ fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif" }}
      >
        {/* ── 페이지 1: 판매가표 ──────────────────────────────────────── */}
        <A4Page>
          <PriceSheetTemplate
            itinerary={itinerary}
            priceTiers={priceTiers}
            excludedDates={excludedDates}
            highlightDate={departureDate}
            confirmedPrice={confirmedPrice}
            mode={mode}
            daysWithDates={daysWithDates}
          />
        </A4Page>

        {/* ── 페이지 2: 상세 일정표 (detail 모드만) ─────────────────── */}
        {mode === 'detail' && (
          <A4Page>
            {hasItinerary ? (
              <ItineraryPage
                itinerary={itinerary}
                daysWithDates={daysWithDates}
                confirmedPrice={confirmedPrice}
                departureDate={departureDate}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '16px', color: '#6b7280' }}>
                <div style={{ fontSize: '48px' }}>📋</div>
                <p style={{ fontSize: '18px', fontWeight: 'bold', color: '#374151' }}>일정표 데이터 없음</p>
                <p style={{ fontSize: '14px' }}>이 상품의 일차별 일정표가 아직 등록되지 않았습니다.</p>
                <p style={{ fontSize: '13px', color: '#9ca3af' }}>일정표가 포함된 PDF를 재업로드하면 자동으로 표시됩니다.</p>
              </div>
            )}
          </A4Page>
        )}
      </div>
    </>
  );
}

// ── A4 페이지 컨테이너 ────────────────────────────────────────────────────
function A4Page({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative bg-white overflow-hidden print:shadow-none shadow-2xl"
      style={{ width: '794px', minHeight: '1123px', padding: '32px 36px', pageBreakAfter: 'always' }}
    >
      {children}
    </div>
  );
}

// ── 공통 헤더 ─────────────────────────────────────────────────────────────
function PageHeader({ itinerary, subtitle }: { itinerary: TravelItinerary; subtitle?: string }) {
  const { meta } = itinerary;
  return (
    <div className="mb-4">
      {/* 브랜드 바 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="bg-blue-700 text-white text-xs font-bold px-3 py-1 rounded">여소남</div>
          <span className="text-gray-400 text-xs">가치있는 여행을 소개하는</span>
        </div>
        <span className="text-gray-400 text-xs">{meta.departure_airport} 출발</span>
      </div>
      {/* 상품명 */}
      <div className="border-b-2 border-blue-700 pb-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-black text-gray-900">{meta.title}</h1>
          {meta.product_type && (
            <span className="text-sm font-bold text-blue-700 border border-blue-700 px-2 py-0.5 rounded">
              {meta.product_type}
            </span>
          )}
        </div>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── 페이지 2: 상세 일정표 ─────────────────────────────────────────────────
function ItineraryPage({
  itinerary, daysWithDates, confirmedPrice, departureDate,
}: {
  itinerary: TravelItinerary;
  daysWithDates: (DaySchedule & { resolvedDate: string | null })[];
  confirmedPrice: number | null;
  departureDate: string | null;
}) {
  const { meta, highlights, optional_tours } = itinerary;

  // 지역 cross-day rowspan 사전 계산
  const regionSpans = computeRegionSpans(daysWithDates);

  return (
    <div className="flex flex-col gap-3 h-full">
      <PageHeader
        itinerary={itinerary}
        subtitle={
          departureDate && confirmedPrice
            ? `출발일: ${formatKoDate(departureDate)}  |  ₩${confirmedPrice.toLocaleString()}/인  |  ${meta.airline} ${meta.flight_out}`
            : `${meta.airline} ${meta.flight_out}/${meta.flight_in} · 최소 ${meta.min_participants}명`
        }
      />

      {/* 포함/불포함/쇼핑/비고 — 세로 나열, 카드형 배경, 원문 그대로 */}
      <div className="text-xs flex flex-col gap-1.5">
        <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
          <span className="font-bold text-green-700">✅ 포함 사항 </span>
          <ul className="text-gray-700 mt-0.5">
            {highlights.inclusions.map((item, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-gray-400 flex-shrink-0">•</span>
                <span>{renderBold(item)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-red-50 border border-red-100 rounded px-2 py-1.5">
          <span className="font-bold text-red-600">❌ 불포함 사항 </span>
          <ul className="text-gray-700 mt-0.5">
            {highlights.excludes.map((item, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-gray-400 flex-shrink-0">•</span>
                <span>{renderBold(item)}</span>
              </li>
            ))}
          </ul>
        </div>
        {highlights.shopping && (
          <div className="bg-purple-50 border border-purple-100 rounded px-2 py-1.5">
            <span className="font-bold text-orange-600">🛍 쇼핑: </span>
            <span className="text-gray-700">{renderBold(highlights.shopping)}</span>
          </div>
        )}
        {highlights.remarks.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded px-2 py-1.5">
            <span className="font-bold text-orange-700">⚠️ 비고 및 필수 안내 </span>
            <ul className="text-gray-700 mt-0.5">
              {highlights.remarks.map((r, i) => (
                <li key={i} className="flex gap-1">
                  <span className="text-orange-400 flex-shrink-0">•</span>
                  <span>{renderBold(r)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 일정표 본문 — 카드형 테두리 */}
      <div
        className="flex-1"
        style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb' }}
      >
        <table
          className="w-full border-collapse text-xs"
          style={{ wordBreak: 'keep-all' }}
        >
          <thead>
            <tr className="bg-blue-700 text-white">
              <th style={{ minWidth: '48px', padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid #3b82f6' }}>
                일자
              </th>
              <th style={{ minWidth: '44px', padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid #3b82f6' }}>
                지역
              </th>
              <th style={{ minWidth: '52px', padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid #3b82f6' }}>
                교통편
              </th>
              <th style={{ minWidth: '44px', padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap', borderRight: '1px solid #3b82f6' }}>
                시간
              </th>
              <th style={{ padding: '6px 16px', textAlign: 'left', borderRight: '1px solid #3b82f6' }}>
                일&nbsp;&nbsp;정
              </th>
              <th style={{ minWidth: '64px', padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                식사
              </th>
            </tr>
          </thead>
          <tbody>
            {daysWithDates.map((day, di) => {
              const bgColor = di % 2 === 0 ? '#ffffff' : '#eff6ff';
              const dayRowspan = day.schedule.length;

              return day.schedule.map((item, si) => {
                const isFirst = si === 0;
                const isLastRow = si === day.schedule.length - 1;
                // 일자 마지막 행은 진한 실선, 내부 행은 연한 점선
                const rowBorderBottom = isLastRow
                  ? '2px solid #9ca3af'
                  : '1px dashed #e5e7eb';
                // rowspan 셀(일자/지역/식사)은 항상 진한 하단 선
                const spanCellBorder = '2px solid #9ca3af';

                return (
                  <tr
                    key={`${di}-${si}`}
                    style={{ backgroundColor: bgColor, verticalAlign: 'top', borderBottom: rowBorderBottom }}
                  >
                    {/* 일자 — 하루 전체 rowspan */}
                    {isFirst && (
                      <td
                        rowSpan={dayRowspan}
                        style={{
                          minWidth: '48px',
                          padding: '6px 4px',
                          textAlign: 'center',
                          fontWeight: 'bold',
                          color: '#1e40af',
                          verticalAlign: 'middle',
                          whiteSpace: 'nowrap',
                          borderRight: '1px solid #e5e7eb',
                          borderBottom: spanCellBorder,
                        }}
                      >
                        제{day.day}일
                        {day.resolvedDate && (
                          <div style={{ fontWeight: 'normal', color: '#6b7280', fontSize: '10px', marginTop: '2px' }}>
                            {formatKoDate(day.resolvedDate)}
                          </div>
                        )}
                      </td>
                    )}

                    {/* 지역 — cross-day rowspan */}
                    {isFirst && regionSpans[di].show && (
                      <td
                        rowSpan={regionSpans[di].rowspan}
                        style={{
                          minWidth: '44px',
                          padding: '6px 4px',
                          textAlign: 'center',
                          color: '#374151',
                          fontWeight: '600',
                          verticalAlign: 'middle',
                          whiteSpace: 'nowrap',
                          borderRight: '1px solid #e5e7eb',
                          borderBottom: spanCellBorder,
                        }}
                      >
                        {day.regions.map((r, ri) => (
                          <div key={ri}>{r}</div>
                        ))}
                      </td>
                    )}

                    {/* 교통편 */}
                    <td
                      style={{
                        minWidth: '52px',
                        padding: '4px 6px',
                        textAlign: 'center',
                        color: '#4b5563',
                        whiteSpace: 'nowrap',
                        borderRight: '1px solid #e5e7eb',
                      }}
                    >
                      {item.transport || ''}
                    </td>

                    {/* 시간 */}
                    <td
                      style={{
                        minWidth: '44px',
                        padding: '4px 6px',
                        textAlign: 'center',
                        color: '#4b5563',
                        whiteSpace: 'nowrap',
                        borderRight: '1px solid #e5e7eb',
                      }}
                    >
                      {item.time || ''}
                    </td>

                    {/* 일정 — 가장 넓은 칸, 왼쪽 여백 */}
                    <td
                      style={{
                        paddingTop: '5px',
                        paddingBottom: '5px',
                        paddingLeft: '14px',
                        paddingRight: '8px',
                        borderRight: '1px solid #e5e7eb',
                        backgroundColor:
                          item.type === 'hotel' && day.hotel ? '#eff6ff' : undefined,
                      }}
                    >
                      {item.type === 'hotel' && day.hotel ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#1e40af', fontWeight: '600' }}>
                          <span>🏨</span>
                          <span>
                            {day.hotel.name}
                            {day.hotel.grade ? ` (${day.hotel.grade})` : ''}
                            {day.hotel.note ? ` ${day.hotel.note}` : ''}
                          </span>
                        </div>
                      ) : (
                        <div
                          style={{
                            color:
                              item.type === 'optional'
                                ? '#c2410c'
                                : item.type === 'shopping'
                                ? '#7e22ce'
                                : undefined,
                          }}
                        >
                          <span style={{ fontWeight: 'bold' }}>{item.activity}</span>
                          {item.note && (
                            <span
                              style={{
                                display: 'block',
                                fontSize: '10px',
                                color: '#9ca3af',
                                lineHeight: '1.4',
                                marginTop: '2px',
                              }}
                            >
                              {item.note}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 식사 — 하루 전체 rowspan */}
                    {isFirst && (
                      <td
                        rowSpan={dayRowspan}
                        style={{
                          minWidth: '64px',
                          padding: '6px 6px',
                          verticalAlign: 'middle',
                          borderBottom: spanCellBorder,
                        }}
                      >
                        <MealCell meals={day.meals} />
                      </td>
                    )}
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>

      {/* 선택관광 */}
      {optional_tours.length > 0 && (
        <div className="text-xs border border-orange-200 rounded bg-orange-50 px-3 py-1.5">
          <span className="font-bold text-orange-700 mr-2">선택관광 (별도판매가)</span>
          {optional_tours.map((t, i) => (
            <span key={i} className="mr-3 text-gray-700">
              ▪ {t.name}
              {t.price_usd && ` $${t.price_usd}`}
              {t.price_krw && ` ₩${t.price_krw.toLocaleString()}`}
              {t.note && ` (${t.note})`}
            </span>
          ))}
        </div>
      )}

      {/* 푸터 */}
      <div className="mt-auto pt-2 border-t border-gray-200 flex justify-between text-xs text-gray-400">
        <span>여소남 — 가치있는 여행을 소개합니다</span>
        <span>※ 상기 일정은 현지 및 항공사 사정에 의해 변경될 수 있습니다.</span>
      </div>
    </div>
  );
}
