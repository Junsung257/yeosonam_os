'use client';

import React from 'react';
import { groupForPoster, getEffectivePriceDates, type PriceDate, type MonthGroup } from '@/lib/price-dates';
import { parseDaysWithTransport, isTransportSegment } from '@/lib/transportParser';
import { matchAttraction as matchAttractionShared, matchAttractions as matchAttractionsShared } from '@/lib/attraction-matcher';
import type { AttractionData } from '@/lib/attraction-matcher';
import { formatDepartureDays } from '@/lib/admin-utils';
import { normalizeOptionalTourName, type OptionalTourInput } from '@/lib/itinerary-render';
import { renderPackage, getAirlineName, type CanonicalView } from '@/lib/render-contract';
import type { NoticeBlock } from '@/lib/standard-terms';
import TransportBar from '@/components/itinerary/TransportBar';

/**
 * ══════════════════════════════════════════════════════════
 * 여소남 OS — YeosonamA4Template (레고 블록 아키텍처)
 * ══════════════════════════════════════════════════════════
 *
 * Stitch v2 디자인 적용
 * - Page 1: 요약/가격 (YEOSONAM 헤더)
 * - Page 2+: 일정표 (12-column grid, border-l-4 카드)
 * - 동적 페이지네이션: 3일 단위 자동 분할
 * - 모든 페이지: className="a4-export-page"
 */

// ── 타입 ─────────────────────────────────────────────────
interface PriceTier {
  period_label: string;
  departure_dates?: string[];
  date_range?: { start: string; end: string };
  departure_day_of_week?: string;
  adult_price?: number;
  child_price?: number;
  status: string;
  note?: string;
}

interface DaySchedule {
  day: number;
  regions?: string[];
  meals?: {
    breakfast?: boolean; lunch?: boolean; dinner?: boolean;
    breakfast_note?: string | null; lunch_note?: string | null; dinner_note?: string | null;
  };
  schedule?: { time?: string | null; activity: string; transport?: string | null; type?: string; badge?: string | null; note?: string | null }[];
  hotel?: { name: string; grade?: string | null; note?: string | null } | null;
}

interface TravelItinerary {
  meta?: {
    title?: string; destination?: string; nights?: number; days?: number;
    departure_airport?: string | null; airline?: string | null;
    flight_out?: string | null; flight_in?: string | null;
    departure_days?: string | null; min_participants?: number;
    ticketing_deadline?: string | null;
  };
  highlights?: {
    inclusions?: string[]; excludes?: string[];
    shopping?: string | null; remarks?: string[];
  };
  days?: DaySchedule[];
  optional_tours?: { name: string; price_usd?: number | null; price_krw?: number | null; note?: string | null }[];
}

interface PriceRule {
  condition: string;
  price_text: string;
  price: number | null;
  badge?: string | null;
}
interface PriceListItem {
  period: string;
  rules: PriceRule[];
  notes?: string | null;
}

export interface AttractionInfo {
  name: string;
  short_desc?: string;
  category?: string;
  badge_type?: string; // 'tour' | 'special' | 'shopping' | 'meal'
  emoji?: string;
  country?: string;
  region?: string;
}

export interface YeosonamA4Props {
  pkg: {
    id?: string;
    title?: string;
    display_title?: string;
    display_name?: string;
    destination?: string;
    duration?: number;
    airline?: string;
    departure_airport?: string;
    departure_days?: string;
    min_participants?: number;
    ticketing_deadline?: string;
    price_tiers?: PriceTier[];
    price_list?: PriceListItem[];
    inclusions?: string[];
    excludes?: string[];
    guide_tip?: string;
    single_supplement?: string;
    optional_tours?: { name: string; price?: string; price_usd?: number; price_krw?: number | null; note?: string | null }[];
    itinerary_data?: TravelItinerary;
    /** @deprecated 고객 fallback 경로 제거됨. customer_notes 사용. */
    special_notes?: string;
    customer_notes?: string;
    internal_notes?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    notices_parsed?: any[];
    excluded_dates?: string[];
    confirmed_dates?: string[];
    price_dates?: { date: string; price: number; child_price?: number; confirmed: boolean }[];
    product_type?: string;
    product_highlights?: string[];
    // ERR-20260418-03: 써차지 객체 배열 (A4 포스터가 기간 날짜 렌더링에 사용)
    surcharges?: { name?: string; start?: string; end?: string; amount?: number; currency?: string; unit?: string }[];
  };
  attractions?: AttractionInfo[];
  /** 4-level 머지된 약관 (surface='a4' 필터됨). 제공 시 A4 전용 축약 렌더링. */
  resolvedNotices?: NoticeBlock[];
}

// ── 유틸 ─────────────────────────────────────────────────
const DEFAULT_DAYS_PER_PAGE = 4;
const PAGE_STYLE: React.CSSProperties = { width: '800px', aspectRatio: '210/297', background: 'white', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box' as const };

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

const E = { contentEditable: true, suppressContentEditableWarning: true } as const;
const EC = 'outline-none focus:bg-yellow-50';


// ══════════════════════════════════════════════════════════
//  메인 컴포넌트
// ══════════════════════════════════════════════════════════

// ERR-20260417-03 — 콤마 관광지 매칭: 복수 매칭 지원
// activity가 콤마 포함이면 matchAttractions(복수)로 모든 관광지 매칭 후 첫 항목 반환.
// splitScheduleItems가 등록 시 콤마 분리하지만, 레거시 데이터 호환을 위해 폴백 유지.
function matchAttraction(activity: string, attractions?: AttractionInfo[], destination?: string): AttractionInfo | null {
  if (!attractions?.length) return null;
  const single = matchAttractionShared(activity, attractions as unknown as AttractionData[], destination);
  if (single) return single as unknown as AttractionInfo;
  const multi = matchAttractionsShared(activity, attractions as unknown as AttractionData[], destination);
  return (multi[0] as unknown as AttractionInfo) || null;
}

export default function YeosonamA4Template({ pkg, attractions, resolvedNotices }: YeosonamA4Props) {
  if (!pkg) return <div style={PAGE_STYLE} className="a4-export-page animate-pulse bg-gray-50" />;

  // 제목 클렌징: 랜드사명/항공사 코드/해시태그/특전나열 제거 (CLAUDE.md 8번 원칙)
  // display_title이 null인 구상품은 pkg.title 폴백 시 "[BX] ... (투어폰)" 형태 오염 발생.
  const SUPPLIER_SUFFIX_RE = /\s*\((?:투어폰|투어비|더투어|랜드부산|여소남|모두투어|베스트아시아|투어코코넛|티트레블|하나투어)\)\s*$/;
  const AIRLINE_PREFIX_RE = /^\s*\[[A-Z0-9]{1,4}\]\s*/;
  const HASHTAG_TAIL_RE = /\s+#[^\s#]+(?:\s+#[^\s#]+)*\s*$/;

  const rawTitle = pkg.display_title || pkg.display_name || pkg.title || '상품명';
  const title = rawTitle
    .replace(AIRLINE_PREFIX_RE, '')     // "[BX] " prefix 제거
    .replace(SUPPLIER_SUFFIX_RE, '')    // " (투어폰)" suffix 제거
    .replace(HASHTAG_TAIL_RE, '')       // " #온천1박 #유후인 ..." 꼬리 해시태그 제거
    .split(/\s*[—–]\s+/)[0]             // " — " 이후 특전 나열 제거
    .trim();
  const itinerary = pkg.itinerary_data;

  // W1 CRC — 렌더링 계약 단일 진입점. pkg 필드를 렌더러 내부에서 다시 파싱하지 말 것 (ERR-KUL-05).
  const view: CanonicalView = renderPackage(pkg as Parameters<typeof renderPackage>[0]);

  // 핵심 특전: 상위 4개 + 단독 무의미 단어만 제외 (수식어 붙으면 통과)
  // 예: "마사지" → 제외, "전신 마사지 120분" → 통과 (가치 있는 소구점)
  const EXCLUDED_EXACT = new Set(['노팁', '노옵션', '노쇼핑']); // 이것들은 무조건 제외
  const EXCLUDED_IF_SHORT = ['전통공연', '마사지', '유목민', '수테차', '오아시스']; // 5글자 이하일 때만 제외
  const filteredHighlights = (pkg.product_highlights || [])
    .filter(h => {
      if (EXCLUDED_EXACT.has(h.trim())) return false;
      if (h.length <= 5 && EXCLUDED_IF_SHORT.some(ex => h.includes(ex))) return false;
      return true;
    })
    .slice(0, 4);

  // 직항 도착 도시 추출: 1일차 도착 항공편에서 도시명 파싱 (ERR-20260418-17)
  const arrivalCityName = (() => {
    const rawDays = Array.isArray(itinerary) ? itinerary : (itinerary?.days || []);
    const firstDay = rawDays[0];
    if (!firstDay?.schedule) return undefined;
    const arrivalFlight = firstDay.schedule.find(
      (s: { type?: string; activity?: string }) => s.type === 'flight' && s.activity && /도착|입국/.test(s.activity)
    );
    if (!arrivalFlight?.activity) return undefined;
    const act = arrivalFlight.activity;
    // 1) "→ 타이페이 도착" 또는 "→ 타이페이 (국제)공항 도착" 패턴 우선
    const arrowMatch = act.match(/→\s*([가-힣A-Za-z]+(?:\s[가-힣A-Za-z]+)?)\s*(?:국제)?공항?\s*(?:도착|입국)/);
    if (arrowMatch) return arrowMatch[1].trim();
    // 2) "타이페이 공항 도착" 또는 "비엔티엔 도착" — 공백 기준 마지막 단어
    const m = act.match(/(?:^|\s)([가-힣]{2,6}|[A-Za-z]{3,20})\s*(?:국제)?공항?\s*(?:도착|입국)/);
    if (m) return m[1].trim();
    return undefined;
  })();

  // itinerary_data가 배열로 직접 저장된 경우 대응 (days 래퍼 없이)
  const days = Array.isArray(itinerary) ? itinerary : (itinerary?.days || []);
  // ERR-20260418-07 — 일정 하단 잘림 방지 (페이지 분배 높이 보수적 계산)
  // 원인: activities * 28px 과소 추정 → 4일차 16:40 이후 잘림
  // 해결: 관광지 short_desc/배지/여백 포함 실측치 반영 (42px/활동)
  const estimateDayHeight = (day: DaySchedule) => {
    const routeH = 40;
    const flightBarH = day.schedule?.some(s => s.type === 'flight') ? 50 : 0;
    const activities = (day.schedule?.filter(s => s.type !== 'flight')?.length || 0);
    const actH = activities * 42; // 관광지 설명/배지 포함 보수적 값
    const noteH = (day.schedule?.filter(s => s.note)?.length || 0) * 18;
    const hotelMealH = 45;
    const gapH = 24;
    return routeH + flightBarH + actH + noteH + hotelMealH + gapH;
  };
  const PAGE_CONTENT_HEIGHT = 950; // 안전 마진 확보 (기존 980 → 950)
  // 탐욕법으로 페이지 분배
  const dayChunks: DaySchedule[][] = [];
  let currentChunk: DaySchedule[] = [];
  let currentHeight = 0;
  for (const day of days) {
    const h = estimateDayHeight(day);
    if (currentChunk.length > 0 && currentHeight + h > PAGE_CONTENT_HEIGHT) {
      dayChunks.push(currentChunk);
      currentChunk = [day];
      currentHeight = h;
    } else {
      currentChunk.push(day);
      currentHeight += h;
    }
  }
  if (currentChunk.length > 0) dayChunks.push(currentChunk);

  // 출발 도시명 추출
  const departCity = (() => {
    const ap = pkg.departure_airport || '';
    if (ap.includes('김해') || ap.includes('부산')) return '부산';
    if (ap.includes('인천') || ap.includes('서울')) return '서울/인천';
    if (ap.includes('김포')) return '서울/김포';
    if (ap.includes('대구')) return '대구';
    if (ap.includes('제주')) return '제주';
    if (ap.includes('청주')) return '청주';
    return ap.replace(/국제공항|공항/g, '').trim();
  })();

  // 뱃지 공통 (출발지 맨 앞 + 강조)
  const TAG = 'px-2 py-0.5 text-[13px] rounded font-semibold';
  // W1 CRC — airline 배지 라벨은 view 단일 출력만 소비 (ERR-20260418-13/17)
  const cleanAirline = view.airlineHeader.airlineLabel ?? undefined;
  const badgesContent = <>
    {departCity && <span className={`${TAG} bg-blue-800 text-white`}>{departCity}출발</span>}
    {pkg.destination && <span className={`${TAG} bg-slate-100 text-slate-700`}>{pkg.destination}</span>}
    {cleanAirline && <span className={`${TAG} bg-slate-100 text-slate-700`}>✈️ {cleanAirline}</span>}
    {(pkg.min_participants || itinerary?.meta?.min_participants) && <span className={`${TAG} bg-slate-100 text-slate-700`}>최소 {pkg.min_participants || itinerary?.meta?.min_participants}명</span>}
    {pkg.product_type && <span className={`${TAG} bg-amber-50 text-amber-700`}>{pkg.product_type}</span>}
    {pkg.ticketing_deadline && <span className={`${TAG} bg-red-50 text-red-600 font-bold border border-red-200`}>{pkg.ticketing_deadline}까지 발권</span>}
    {formatDepartureDays(pkg.departure_days) && <span className="text-[13px] text-slate-500">출발: {formatDepartureDays(pkg.departure_days)}</span>}
  </>;

  // 마지막 페이지(포함/불포함/유의사항) 표시 여부 판단
  const hasResolved = (resolvedNotices?.length ?? 0) > 0;
  const hasNotices = hasResolved || (pkg.notices_parsed?.length ?? 0) > 0 || !!pkg.customer_notes;
  // Phase 1 CRC: pkg.inclusions 직접 접근 제거 → view.inclusions 에서 flat count 소비
  const hasIncludeExclude =
    view.inclusions.flat.length > 0 ||
    view.excludes.basic.length > 0 ||
    view.surchargesMerged.length > 0 ||
    !!view.shopping.text;
  const hasLastPage = hasNotices || hasIncludeExclude;

  // ERR-20260418-11/12 — 요금표 적응형 청크 분할 (Universal 알고리즘)
  // 목표: 짧은 상품 / 긴 상품 / 초대형 상품 모두 정확히 렌더링 (어떤 경우에도 잘림 없음)
  //
  // 알고리즘:
  //   1. 월 그룹을 순회하면서 행 수 누적
  //   2. Page 1 예산(12행) / 이후 페이지 예산(22행) 초과 시 새 청크 시작
  //   3. 한 월이 한 페이지 예산도 초과하면 그 월을 price 그룹별로 분할 (Fallback)
  //      (예: 한 달에 30행 이상 = "매일 출발" 상품)
  //
  // 이 3단 방어로 임의 크기 상품 모두 처리됨.
  const priceDatesForTable = getEffectivePriceDates({
    price_dates: pkg.price_dates,
    price_tiers: pkg.price_tiers as unknown as Parameters<typeof getEffectivePriceDates>[0]['price_tiers'],
  });
  const allMonthGroups = groupForPoster(priceDatesForTable);
  // 전체 요금표의 최저가 (청크 분할 시 모든 페이지가 동일 globalMin 사용)
  const priceTableGlobalMin = (() => {
    const allPrices = priceDatesForTable.map(d => d.price).filter(p => p > 0);
    return allPrices.length > 0 ? Math.min(...allPrices) : undefined;
  })();
  // ERR-20260418-15 — 페이지 낭비 방지: Page 1 공간 최대 활용 + 추가 페이지 압축
  // 이전 6/16은 너무 보수적 → 4개월 상품이 4페이지로 분산되는 낭비 발생
  // 18/24로 상향: 타이베이(31행)가 2페이지로 정리, 핵심특전+선택관광은 Page 1 상단에 충분
  const PRICE_ROWS_PAGE1 = 18;
  const PRICE_ROWS_OTHER = 24;

  // 각 청크는 (월번호, 가격세트) 배열로 표현. 가격세트 null이면 해당 월 전체
  type PriceChunkFilter = { month: number; prices: Set<number> | null };
  const priceChunks: PriceChunkFilter[][] = [[]];
  const pushToCurrentOrNew = (filter: PriceChunkFilter, rowsToAdd: number, isFirst: boolean, currentRowsRef: { v: number }) => {
    const limit = isFirst ? PRICE_ROWS_PAGE1 : PRICE_ROWS_OTHER;
    const last = priceChunks[priceChunks.length - 1];
    if (currentRowsRef.v + rowsToAdd > limit && last.length > 0) {
      priceChunks.push([filter]);
      currentRowsRef.v = rowsToAdd;
    } else {
      last.push(filter);
      currentRowsRef.v += rowsToAdd;
    }
  };
  {
    const currentRows = { v: 0 };
    for (const g of allMonthGroups) {
      const monthNum = parseInt(g.month);
      const groupRows = 1 + g.rows.length; // 월 헤더 + 요일 행
      const isFirst = priceChunks.length === 1;
      const limit = isFirst ? PRICE_ROWS_PAGE1 : PRICE_ROWS_OTHER;

      // 단일 월이 한 페이지 예산 초과하는 극단 케이스 → 가격별로 쪼개기
      if (groupRows > PRICE_ROWS_OTHER) {
        // 현재 청크가 남은 예산 있으면 거기에 일부, 아니면 새 청크
        const uniquePrices = new Set(g.rows.map(r => r.price));
        for (const price of uniquePrices) {
          const priceRows = g.rows.filter(r => r.price === price).length;
          const subRows = 1 + priceRows; // 월 헤더 중복 포함 (여러 페이지 가독성 위해)
          pushToCurrentOrNew({ month: monthNum, prices: new Set([price]) }, subRows, priceChunks.length === 1, currentRows);
        }
      } else if (currentRows.v + groupRows > limit && priceChunks[priceChunks.length - 1].length > 0) {
        priceChunks.push([{ month: monthNum, prices: null }]);
        currentRows.v = groupRows;
      } else {
        priceChunks[priceChunks.length - 1].push({ month: monthNum, prices: null });
        currentRows.v += groupRows;
      }
    }
  }

  // 각 청크를 priceDates로 변환 (filter)
  const priceChunksDates = priceChunks.map(chunk => {
    return priceDatesForTable.filter(d => {
      const m = parseInt(d.date.slice(5, 7));
      return chunk.some(c => c.month === m && (c.prices === null || c.prices.has(d.price)));
    });
  });
  const firstChunk = priceChunksDates[0] || [];
  const extraChunks = priceChunksDates.slice(1);

  return (
    <div className="flex flex-col items-center gap-10">
      {/* ═══ PAGE 1: 제목 + 메타 + 핵심특전 + 요금표 + 선택관광 ═══ */}
      <article className="a4-export-page" style={PAGE_STYLE}>
        <Page1Header title={title} badges={badgesContent} />
        <main className="flex-1 px-10 pb-3 text-[#0b1c30]">
          {/* 핵심 특전 (최대 4개, 중복/약한 항목 제외) */}
          {filteredHighlights.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className="text-[13px] font-bold text-amber-700">★ 핵심 특전</span>
              {filteredHighlights.map((h, i) => (
                <span key={i} className="px-1.5 py-0.5 bg-amber-50 text-amber-800 text-[12px] rounded border border-amber-200 font-medium">{h}</span>
              ))}
            </div>
          )}
          {/* Page 1 요금표 (firstChunk가 없더라도, price_list가 있으면 표시) */}
          {(pkg.price_list?.length || firstChunk.length > 0) ? (
            <PriceTable
              priceList={pkg.price_list}
              priceDates={firstChunk}
              tiers={undefined}
              excludedDates={pkg.excluded_dates}
              confirmedDates={pkg.confirmed_dates}
              globalMin={priceTableGlobalMin}
            />
          ) : null}
          {(pkg.optional_tours?.length ?? 0) > 0 && <OptionalTours tours={pkg.optional_tours!} />}
        </main>
      </article>

      {/* ═══ 요금표 추가 페이지 (긴 상품 대응) ═══ */}
      {extraChunks.map((chunk, idx) => (
        <article key={`price-${idx}`} className="a4-export-page" style={PAGE_STYLE}>
          <ItineraryPageHeader
            title={title}
            departureAirport={pkg.departure_airport}
            destination={pkg.destination}
            airline={pkg.airline}
            arrivalCity={arrivalCityName}
            flightOut={itinerary?.meta?.flight_out ?? undefined}
          />
          <main className="flex-1 px-10 py-6 text-[#0b1c30]">
            {/* ERR-20260418-15: "(계속)" 제거 — 월 헤더가 어느 월인지 자동 표시 */}
            <PriceTable
              priceList={undefined} // 중복 표시 방지
              priceDates={chunk}
              tiers={undefined}
              excludedDates={pkg.excluded_dates}
              confirmedDates={pkg.confirmed_dates}
              globalMin={priceTableGlobalMin}
            />
          </main>
        </article>
      ))}

      {/* ═══ PAGE 2+: 일정 (Stitch v2 디자인) ═══ */}
      {dayChunks.map((chunk, chunkIdx) => (
        <article key={chunkIdx} className="a4-export-page" style={PAGE_STYLE}>
          <ItineraryPageHeader
            title={title}
            departureAirport={pkg.departure_airport}
            destination={pkg.destination}
            airline={pkg.airline}
            arrivalCity={arrivalCityName}
            flightOut={itinerary?.meta?.flight_out ?? undefined}
          />
          <div className="flex-1 px-10 pb-8">
            <DailyItinerary days={chunk} attractions={attractions} destination={pkg.destination} />
          </div>
          {/* 푸터 삭제 — 40px 확보 */}
        </article>
      ))}

      {/* ═══ 마지막 페이지: 포함/불포함 + 유의사항 ═══ */}
      {hasLastPage && (
        <article className="a4-export-page" style={PAGE_STYLE}>
          <ItineraryPageHeader
            title={title}
            departureAirport={pkg.departure_airport}
            destination={pkg.destination}
            airline={pkg.airline}
            arrivalCity={arrivalCityName}
            flightOut={itinerary?.meta?.flight_out ?? undefined}
          />
          <main className="flex-1 px-10 py-6 text-[#0b1c30] space-y-4">
            {hasIncludeExclude && (
              <IncludeExcludeInfo view={view} />
            )}
            {/* ERR-20260418-08: Page 1에 이미 OptionalTours 표시되므로 중복 제거 */}
            {resolvedNotices && resolvedNotices.length > 0 ? (
              <ResolvedNoticesA4Page notices={resolvedNotices} packageId={pkg.id} />
            ) : hasNotices ? (
              <NoticesPage noticesParsed={pkg.notices_parsed} customerNotes={pkg.customer_notes} />
            ) : null}
          </main>
        </article>
      )}

      {/* 일정 없으면 빈 페이지 */}
      {days.length === 0 && (
        <article className="a4-export-page" style={PAGE_STYLE}>
          <ItineraryPageHeader title={title} />
          <div className="flex-1 px-10 pb-8 flex items-center justify-center">
            <p className="text-slate-400 text-[14px]">상세 일정 데이터가 아직 없습니다</p>
          </div>
          {/* 푸터 삭제 — 40px 확보 */}
        </article>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  Page 1 서브 컴포넌트 (요약)
// ══════════════════════════════════════════════════════════

function Page1Header({ title, badges }: { title: string; badges: React.ReactNode }) {
  return (
    <header className="w-full pt-5 pb-3 px-10 bg-white border-b border-slate-200">
      <div className="flex items-center gap-3 mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="여소남" className="h-8 object-contain shrink-0" />
        <h1 {...E} className={`text-[#001f3f] text-3xl font-extrabold leading-tight tracking-tight flex-1 break-keep ${EC}`}>
          {title}
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
    </header>
  );
}



function PriceTable({ priceList, priceDates, tiers, excludedDates, confirmedDates, globalMin }: { priceList?: PriceListItem[]; priceDates?: { date: string; price: number; child_price?: number; confirmed: boolean }[]; tiers?: PriceTier[]; excludedDates?: string[]; confirmedDates?: string[]; globalMin?: number }) {
  // price_list 우선 → price_dates → tiers 폴백 → 모두 없으면 렌더링 안 함
  const usePriceList = priceList && priceList.length > 0;
  const usePriceDates = !usePriceList && priceDates && priceDates.length > 0;
  const useTiers = !usePriceList && !usePriceDates && tiers && tiers.length > 0;
  if (!usePriceList && !usePriceDates && !useTiers) return null;

  const TH = 'text-[14px] bg-[#001f3f] font-semibold text-white py-1.5 px-2';

  // ── price_list 모드: 원본 PDF 구조 그대로 (기간 × 조건 그룹핑) ──
  if (usePriceList) {
    // 전체 최저가 식별
    const allPrices = priceList.flatMap(g => g.rules.map(r => r.price).filter((p): p is number => p !== null && p > 0));
    const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;

    // 조건(condition)명 수집 — 조건이 기간과 다를 때만 조건 열 표시
    const conditionSet = new Set<string>();
    let conditionEqualsePeriod = true;
    for (const g of priceList) {
      for (const r of g.rules) {
        conditionSet.add(r.condition);
        // 조건이 기간과 동일하면 조건 열 불필요 (날짜 중복 방지)
        if (r.condition !== g.period && r.condition !== '전 출발일') conditionEqualsePeriod = false;
      }
    }
    const conditions = Array.from(conditionSet);
    const multiCondition = conditions.length > 1 && !conditionEqualsePeriod;

    return (
      <section className="mb-3">
        <h3 {...E} className={`font-bold text-[#001f3f] mb-1.5 text-[15px] ${EC}`}>출발일별 요금</h3>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th className={`${TH} text-left`}>출발 기간</th>
              {multiCondition && <th className={`${TH} text-center`}>조건</th>}
              <th className={`${TH} text-right`}>요금</th>
              <th className={`${TH} text-center`} style={{ width: '55px' }}>비고</th>
            </tr>
          </thead>
          <tbody>
            {(() => { let minShown = false; return priceList.map((group, gIdx) => {
              const ruleCount = group.rules.length;
              return group.rules.map((rule, rIdx) => {
                const isMinPrice = minPrice !== null && rule.price === minPrice;
                const isMin = isMinPrice && !minShown;
                if (isMin) minShown = true;
                const bgClass = gIdx % 2 === 1 ? 'bg-slate-50' : '';
                return (
                  <tr key={`${gIdx}-${rIdx}`} className={bgClass}>
                    {rIdx === 0 && (
                      <td
                        rowSpan={ruleCount}
                        className="text-[14px] py-1.5 px-2 border-b border-slate-200 whitespace-nowrap font-semibold text-slate-800 align-middle"
                      >
                        {group.period}
                      </td>
                    )}
                    {multiCondition && (
                      <td className="text-[13px] py-1 px-2 border-b border-slate-100 text-center whitespace-nowrap text-slate-600">
                        {rule.condition}
                      </td>
                    )}
                    <td {...E} className={`text-[15px] py-1.5 px-2 border-b border-slate-100 text-right whitespace-nowrap tabular-nums ${isMin ? 'text-red-600 font-bold' : 'font-medium'} ${EC}`}>
                      {rule.price ? `₩${rule.price.toLocaleString()}` : rule.price_text || '-'}
                    </td>
                    <td className="text-[13px] py-1 px-2 border-b border-slate-100 text-center whitespace-nowrap">
                      {isMin ? <span className="text-red-600 font-bold text-xs">🔥최저가</span>
                        : rule.badge ? <span className="text-[10px] text-slate-500">{rule.badge}</span>
                        : null}
                    </td>
                  </tr>
                );
              });
            }); })()}
          </tbody>
        </table>
        {/* 부가 조건 (notes) 표 하단 표시 */}
        {priceList.some(g => g.notes) && (
          <div className="mt-1 space-y-0.5">
            {[...new Set(priceList.filter(g => g.notes).map(g => g.notes!))].map((note, i) => (
              <p key={i} className="text-[10px] text-slate-500 leading-snug">• {note}</p>
            ))}
          </div>
        )}
        {excludedDates && excludedDates.length > 0 && (
          <p className="mt-1 text-[10px] text-red-500 leading-snug">• 항공제외일: {excludedDates.join(', ')}</p>
        )}
      </section>
    );
  }

  // ── price_dates 모드: groupForPoster 기반 월별 그룹 렌더링 ──
  if (usePriceDates) {
    // ERR-20260418-29 — 청크 분할 시 외부에서 전체 최저가 전달 (청크 내 최저가 오표시 방지)
    const monthGroups: MonthGroup[] = groupForPoster(priceDates as PriceDate[], globalMin != null ? { globalMinOverride: globalMin } : undefined);

    // 확정일 배너 계산
    const pdConfirmedDates = priceDates!.filter(d => d.confirmed);
    const pdConfirmedByMonth: Record<string, number[]> = {};
    for (const d of pdConfirmedDates) {
      const m = `${parseInt(d.date.split('-')[1])}월`;
      const day = parseInt(d.date.split('-')[2]);
      if (!pdConfirmedByMonth[m]) pdConfirmedByMonth[m] = [];
      if (!pdConfirmedByMonth[m].includes(day)) pdConfirmedByMonth[m].push(day);
    }
    for (const m of Object.keys(pdConfirmedByMonth)) pdConfirmedByMonth[m].sort((a, b) => a - b);

    const hasChild = priceDates!.some(d => d.child_price && d.child_price > 0);

    // 출발제외일 월별 그룹 + 연속범위 압축
    const pdExcludedByMonth: Record<string, number[]> = {};
    for (const d of (excludedDates || [])) {
      const m = `${parseInt(d.split('-')[1])}월`;
      if (!pdExcludedByMonth[m]) pdExcludedByMonth[m] = [];
      const day = parseInt(d.split('-')[2]);
      if (!pdExcludedByMonth[m].includes(day)) pdExcludedByMonth[m].push(day);
    }
    for (const m of Object.keys(pdExcludedByMonth)) pdExcludedByMonth[m].sort((a, b) => a - b);
    function pdCompactDays(days: number[]): string {
      if (!days.length) return '';
      const ranges: string[] = [];
      let start = days[0], end = days[0];
      for (let i = 1; i < days.length; i++) {
        if (days[i] === end + 1) { end = days[i]; }
        else { ranges.push(start === end ? `${start}` : `${start}~${end}`); start = end = days[i]; }
      }
      ranges.push(start === end ? `${start}` : `${start}~${end}`);
      return ranges.join(', ');
    }

    return (
      <section className="mb-3">
        {/* 출발확정일 배너 */}
        {Object.keys(pdConfirmedByMonth).length > 0 && (
          <div className="bg-green-50 border border-green-300 rounded px-2 py-1.5 mb-2 text-[13px] text-green-800 font-semibold">
            🟢 출발확정 (바로 예약 가능)&nbsp;&nbsp;
            {Object.entries(pdConfirmedByMonth).map(([m, days], i) => (
              <span key={m}>{i > 0 ? ' | ' : ''}{m}: {days.join(', ')}일</span>
            ))}
          </div>
        )}
        <h3 {...E} className={`font-bold text-[#001f3f] mb-1.5 text-[15px] ${EC}`}>출발일별 요금</h3>
        {pdConfirmedDates.length > 0 && <p className="text-[9px] text-slate-400 mb-1">* <span className="text-red-600 font-bold">빨간색</span> = 출발확정일</p>}
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th className={`${TH} text-center`} style={{ width: '48px' }}>요일</th>
              <th className={`${TH} text-left`}>출발일</th>
              <th className={`${TH} text-right`}>성인</th>
              {hasChild && <th className={`${TH} text-right`}>아동</th>}
              <th className={`${TH} text-center`} style={{ width: '58px' }}>비고</th>
            </tr>
          </thead>
          <tbody>
            {(() => { let pdMinShown = false; return monthGroups.map((mg) => (
              <React.Fragment key={mg.month}>
                {/* 월 구분 헤더 — ERR-20260418-16: 단일 월 청크에서도 월 표기 */}
                {(
                  <tr>
                    <td colSpan={3 + (hasChild ? 1 : 0) + 1} className="text-[13px] font-bold text-[#001f3f] bg-slate-100 px-2 py-1 border-b border-slate-300">
                      {mg.month}
                    </td>
                  </tr>
                )}
                {mg.rows.map((row, rIdx) => {
                  const bgClass = rIdx % 2 === 1 ? 'bg-slate-50' : '';
                  return (
                    <tr key={`${mg.month}-${rIdx}`} className={bgClass}>
                      <td className="text-[13px] py-1 px-2 border-b border-slate-100 text-center whitespace-nowrap text-slate-700 font-medium">
                        {row.dow || '-'}
                      </td>
                      <td className="text-[13px] py-1 px-2 border-b border-slate-100 text-left leading-snug">
                        <span className="inline">
                          {row.dates.map((dn, di) => (
                            <React.Fragment key={di}>
                              <span className={dn.confirmed ? 'text-red-600 font-bold' : 'text-slate-700'}>{dn.day}</span>
                              {di < row.dates.length - 1 && <span className="text-slate-300">, </span>}
                            </React.Fragment>
                          ))}
                        </span>
                      </td>
                      <td {...E} className={`text-[15px] py-1.5 px-2 border-b border-slate-100 text-right whitespace-nowrap tabular-nums ${row.isLowest ? 'text-red-600 font-bold' : 'font-medium'} ${EC}`}>
                        {row.price ? `₩${row.price.toLocaleString()}` : '-'}
                      </td>
                      {hasChild && (
                        <td {...E} className={`text-[15px] py-1.5 px-2 border-b border-slate-100 text-right whitespace-nowrap tabular-nums ${EC}`}>
                          {row.childPrice ? `₩${row.childPrice.toLocaleString()}` : '-'}
                        </td>
                      )}
                      <td className="text-[13px] py-1 px-2 border-b border-slate-100 text-center whitespace-nowrap">
                        {row.isLowest && !pdMinShown && (() => { pdMinShown = true; return <span className="text-red-600 font-bold text-[10px]">🔥최저가</span>; })()}
                        {row.note && !(row.isLowest && pdMinShown) && <span className="text-[10px] text-slate-500">{row.note}</span>}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            )); })()}
          </tbody>
        </table>
        {/* 출발제외일 월별 (연속범위 압축) */}
        {Object.keys(pdExcludedByMonth).length > 0 && (
          <div className="mt-1.5 bg-red-50 border border-red-200 rounded px-2 py-1 text-[10px] text-red-600 leading-snug">
            <span className="font-bold">출발제외일</span>&nbsp;&nbsp;
            {Object.entries(pdExcludedByMonth).map(([m, days], i) => (
              <span key={m}>{i > 0 ? ' | ' : ''}{m}: {pdCompactDays(days)}</span>
            ))}
          </div>
        )}
      </section>
    );
  }

  // ── tiers 모드: 월별 그룹 + 개별 날짜 표시 (확정일 빨간색) ──

  // 확정일 Set — 패키지 레벨 confirmed_dates 우선, 없으면 tier status 폴백
  const confirmedSet = new Set<string>();
  if (confirmedDates && confirmedDates.length > 0) {
    confirmedDates.forEach(d => confirmedSet.add(d));
  } else {
    for (const tier of tiers!) {
      if (tier.status === 'confirmed' && tier.departure_dates) {
        tier.departure_dates.forEach(d => confirmedSet.add(d));
      }
    }
  }

  // 월별 그룹핑 (departure_dates 기준)
  interface TierDisplayRow {
    dow: string;
    dates: { day: number; iso: string }[];
    adult: number;
    child?: number;
    note?: string;
    status?: string;
  }
  const monthGroups = new Map<string, TierDisplayRow[]>();
  for (const tier of tiers!) {
    const firstDate = tier.departure_dates?.[0];
    const monthNum = firstDate
      ? new Date(firstDate).getMonth() + 1
      : parseInt(tier.period_label.match(/(\d+)/)?.[1] || '0');
    const monthKey = `${monthNum}월`;

    // 요일 추출: period_label에서 날짜/월 부분 제거
    const dow = tier.period_label
      .replace(/^\d+\/[\d~,]+\s*/, '')   // "4/5~19 " → ""
      .replace(/^\d+월\s*/, '')           // "5월 " → ""
      .trim() || tier.departure_day_of_week || '';

    const dates = (tier.departure_dates || []).map(d => ({ day: new Date(d).getDate(), iso: d }));

    if (!monthGroups.has(monthKey)) monthGroups.set(monthKey, []);
    monthGroups.get(monthKey)!.push({ dow, dates, adult: tier.adult_price ?? 0, child: tier.child_price, note: tier.note, status: tier.status });
  }

  // 전역 최저가
  const allPrices = tiers!.map(t => t.adult_price ?? 0).filter(p => p > 0);
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;
  const hasChild = tiers!.some(t => t.child_price && t.child_price > 0);
  const hasDepartureDates = tiers!.some(t => t.departure_dates && t.departure_dates.length > 0);

  // 확정일 배너 데이터 (월별)
  const confirmedByMonth: Record<string, number[]> = {};
  for (const d of confirmedSet) {
    const dt = new Date(d);
    const m = `${dt.getMonth() + 1}월`;
    if (!confirmedByMonth[m]) confirmedByMonth[m] = [];
    const day = dt.getDate();
    if (!confirmedByMonth[m].includes(day)) confirmedByMonth[m].push(day);
  }
  for (const m of Object.keys(confirmedByMonth)) confirmedByMonth[m].sort((a, b) => a - b);

  // 출발제외일 월별 그룹 + 연속범위 압축
  const excludedByMonth: Record<string, number[]> = {};
  for (const d of (excludedDates || [])) {
    const dt = new Date(d);
    const m = `${dt.getMonth() + 1}월`;
    if (!excludedByMonth[m]) excludedByMonth[m] = [];
    excludedByMonth[m].push(dt.getDate());
  }
  for (const m of Object.keys(excludedByMonth)) excludedByMonth[m].sort((a, b) => a - b);
  function compactDays(days: number[]): string {
    if (!days.length) return '';
    const ranges: string[] = [];
    let start = days[0], end = days[0];
    for (let i = 1; i < days.length; i++) {
      if (days[i] === end + 1) { end = days[i]; }
      else { ranges.push(start === end ? `${start}` : `${start}~${end}`); start = end = days[i]; }
    }
    ranges.push(start === end ? `${start}` : `${start}~${end}`);
    return ranges.join(', ');
  }

  // 비고 notes 수집
  const tierNotes = [...new Set(tiers!.filter(t => t.note).map(t => t.note!))];

  return (
    <section className="mb-3">
      {/* 출발확정일 배너 */}
      {Object.keys(confirmedByMonth).length > 0 && (
        <div className="bg-green-50 border border-green-300 rounded px-2 py-1.5 mb-2 text-[13px] text-green-800 font-semibold">
          🟢 출발확정 (바로 예약 가능)&nbsp;&nbsp;
          {Object.entries(confirmedByMonth).map(([m, days], i) => (
            <span key={m}>{i > 0 ? ' | ' : ''}{m}: {days.join(', ')}일</span>
          ))}
        </div>
      )}
      <h3 {...E} className={`font-bold text-[#001f3f] mb-1.5 text-[15px] ${EC}`}>출발일별 요금</h3>
      {confirmedSet.size > 0 && <p className="text-[9px] text-slate-400 mb-1">* <span className="text-red-600 font-bold">빨간색</span> = 출발확정일</p>}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th className={`${TH} text-center`} style={{ width: '48px' }}>요일</th>
            {hasDepartureDates && <th className={`${TH} text-left`}>출발일</th>}
            {!hasDepartureDates && <th className={`${TH} text-left`}>출발 기간</th>}
            <th className={`${TH} text-right`}>성인</th>
            {hasChild && <th className={`${TH} text-right`}>아동</th>}
            <th className={`${TH} text-center`} style={{ width: '58px' }}>비고</th>
          </tr>
        </thead>
        <tbody>
          {(() => { let tierMinShown = false; return [...monthGroups.entries()].map(([month, rows]) => (
            <React.Fragment key={month}>
              {/* 월 구분 헤더 — ERR-20260418-16: 단일 월 청크에서도 월 표기 */}
              {(
                <tr>
                  <td colSpan={3 + (hasChild ? 1 : 0) + 1} className="text-[13px] font-bold text-[#001f3f] bg-slate-100 px-2 py-1 border-b border-slate-300">
                    {month}
                  </td>
                </tr>
              )}
              {rows.map((row, rIdx) => {
                const isMinPrice = minPrice !== null && row.adult === minPrice;
                const isSoldout = row.status === 'soldout';
                const isMin = isMinPrice && !isSoldout && !tierMinShown;
                if (isMin) tierMinShown = true;
                const bgClass = rIdx % 2 === 1 ? 'bg-slate-50' : '';
                return (
                  <tr key={`${month}-${rIdx}`} className={bgClass}>
                    <td className="text-[13px] py-1 px-2 border-b border-slate-100 text-center whitespace-nowrap text-slate-700 font-medium">
                      {row.dow || '-'}
                    </td>
                    <td className="text-[13px] py-1 px-2 border-b border-slate-100 text-left leading-snug">
                      {hasDepartureDates && row.dates.length > 0 ? (
                        <span className="inline">
                          {row.dates.map((dn, di) => {
                            const isConfirmed = confirmedSet.has(dn.iso);
                            return (
                              <React.Fragment key={di}>
                                <span className={isConfirmed ? 'text-red-600 font-bold' : 'text-slate-700'}>{dn.day}</span>
                                {di < row.dates.length - 1 && <span className="text-slate-300">, </span>}
                              </React.Fragment>
                            );
                          })}
                        </span>
                      ) : (
                        <span className="text-slate-700">{tiers!.find(t => t.adult_price === row.adult && (t.departure_day_of_week || '') === (row.dow || ''))?.period_label || '-'}</span>
                      )}
                    </td>
                    <td {...E} className={`text-[15px] py-1.5 px-2 border-b border-slate-100 text-right whitespace-nowrap tabular-nums ${isSoldout ? 'text-gray-400 line-through' : isMin ? 'text-red-600 font-bold' : 'font-medium'} ${EC}`}>
                      {row.adult ? `₩${row.adult.toLocaleString()}` : '-'}
                    </td>
                    {hasChild && (
                      <td {...E} className={`text-[15px] py-1.5 px-2 border-b border-slate-100 text-right whitespace-nowrap tabular-nums ${isSoldout ? 'text-gray-400 line-through' : ''} ${EC}`}>
                        {row.child ? `₩${row.child.toLocaleString()}` : '-'}
                      </td>
                    )}
                    <td className="text-[13px] py-1 px-2 border-b border-slate-100 text-center whitespace-nowrap">
                      {isSoldout && <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-bold">마감</span>}
                      {isMin && !isSoldout && <span className="text-red-600 font-bold text-[10px]">🔥최저가</span>}
                    </td>
                  </tr>
                );
              })}
            </React.Fragment>
          )); })()}
        </tbody>
      </table>
      {/* 비고 notes */}
      {tierNotes.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {tierNotes.map((note, i) => (
            <p key={i} className="text-[10px] text-blue-600 leading-snug">• {note}</p>
          ))}
        </div>
      )}
      {/* 출발제외일 월별 (연속범위 압축) */}
      {Object.keys(excludedByMonth).length > 0 && (
        <div className="mt-1.5 bg-red-50 border border-red-200 rounded px-2 py-1 text-[10px] text-red-600 leading-snug">
          <span className="font-bold">출발제외일</span>&nbsp;&nbsp;
          {Object.entries(excludedByMonth).map(([m, days], i) => (
            <span key={m}>{i > 0 ? ' | ' : ''}{m}: {compactDays(days)}</span>
          ))}
        </div>
      )}
    </section>
  );
}

// 유의사항 이모지 자동 매칭
function getNoteEmoji(text: string): string {
  if (/여권|비자|visa|passport|만료/i.test(text)) return '🛂';
  if (/취소|환불|cancel|수수료/i.test(text)) return '🚫';
  if (/보험|insurance/i.test(text)) return '🛡️';
  if (/공항|airport|탑승|항공/i.test(text)) return '✈️';
  if (/호텔|숙박|객실|일회용/i.test(text)) return '🏨';
  if (/식사|음식|food|식품|돼지|검역/i.test(text)) return '🍽️';
  if (/쇼핑|shopping|면세/i.test(text)) return '🛍️';
  if (/팁|tip|가이드|경비/i.test(text)) return '💰';
  if (/써차지|할증|추가요금/i.test(text)) return '💲';
  if (/일정|변경|change|패널티|미참여/i.test(text)) return '📋';
  if (/현지|사정|weather|기상/i.test(text)) return '🌏';
  if (/아동|어린이|유아|child|미성년|청소년/i.test(text)) return '👶';
  if (/건강|약|의료|담배|전자담배/i.test(text)) return '💊';
  if (/싱글|차지|1인실/i.test(text)) return '🛏️';
  if (/옵션|조인|행사/i.test(text)) return '🎯';
  if (/라면|컵라면|음식물/i.test(text)) return '🍜';
  return '📍';
}

// special_notes 원문을 문장 단위로 분리하는 폴백 파서
function splitSpecialNotes(raw: string): string[] {
  // 1단계: PDF 구분자 정리 → 문장 분리 마커로 치환
  const cleaned = raw
    .replace(/\*\s*[.,!]{0,5}\s*\*+/g, '|||')   // *..*  *...*  *,!!)* 등
    .replace(/\*\s*[.,!]{0,5}\s*$/g, '|||')      // 끝에 붙은 *..
    .replace(/^\s*\*\s*/gm, '|||')               // 줄 시작 *
    .replace(/\)\s*(?=[가-힣])/g, ') |||')        // ")대만" → ") ||| 대만"

  // 2단계: 한국어 문장 끝 패턴으로도 분리
  const withSentenceBreaks = cleaned
    .replace(/(?<=합니다|됩니다|바랍니다|드립니다|있습니다|없습니다|주세요|마세요|입니다)\.?\s+/g, '|||');

  let items = withSentenceBreaks.split('|||').map(s => s.trim()).filter(Boolean);

  // 폴백: 줄바꿈
  if (items.length <= 1) {
    items = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
  }

  return items
    .map(s => s
      .replace(/^\d+\.\s*/, '')       // 번호 접두사 "1. "
      .replace(/^\*+\s*/, '')         // 앞 *
      .replace(/\s*\*+$/, '')         // 뒤 *
      .replace(/^\)\s*/, '')          // 앞 닫는 괄호 잔해 ") "
      .replace(/\s+주의\s*[.!]*$/, ' 주의')  // "주의" 뒤 정리
      .replace(/\s+(\d+)\.\s*$/, '')  // 끝에 "720." 같은 잘린 숫자 제거 방지 — 보존
      .replace(/\s{2,}/g, ' ')        // 다중 공백 → 단일
      .trim()
    )
    .filter(s => s.length >= 5)
    // 중복 제거 (앞 25자 기준)
    .filter((s, i, arr) => arr.findIndex(x => x.substring(0, 25) === s.substring(0, 25)) === i);
}

// NoticeItem 타입 (parser에서 export)
interface NoticeItemLocal { type: 'CRITICAL' | 'PAYMENT' | 'POLICY' | 'INFO'; title: string; text: string; }

const MAX_BULLETS = 6;
const VALID_TYPES: NoticeItemLocal['type'][] = ['CRITICAL', 'PAYMENT', 'POLICY', 'INFO'];

// 공통 항목 필터 — 예약안내문에 있는 내용은 일정표에서 제거
// ※ 국가별 규정(담배, 전자담배, 흡연, 대마, TDAC 등)은 제거하지 않음!
const COMMON_NOTICE_PATTERNS = [
  /현금영수증/,
  /개별행동.*불가|개별일정.*불가/,
  /완납.*기준|1주일.*완납|2주.*완납/,
  /취소.*문의.*평일|09시.*18시/,
  /인원.*다를.*경우.*지불/,
  /확인.*동의.*예약.*진행/,
  /예약진행.*부탁/,
];

function isCommonNotice(bullet: string): boolean {
  // 안전장치: 아래 조건에 해당하면 절대 삭제 금지
  if (/%|공제.*환불|\d+만원/.test(bullet)) return false;  // 수수료율/금액
  if (/단수여권|훼손/.test(bullet)) return false;          // 특수 여권 규정
  if (/\d+보루|\d+병|벌금/.test(bullet)) return false;     // 국가별 규정 (숫자 포함)
  // 공통 패턴 매칭
  return COMMON_NOTICE_PATTERNS.some(p => p.test(bullet));
}

/**
 * Gemini 출력 후처리 — 공통 항목 제거 + 4건 × 최대 6불렛 정규화
 */
function normalizeNotices(raw: NoticeItemLocal[]): NoticeItemLocal[] {
  // Step 1: 같은 type끼리 병합
  const merged = new Map<NoticeItemLocal['type'], { titles: string[]; bullets: string[] }>();
  for (const t of VALID_TYPES) merged.set(t, { titles: [], bullets: [] });

  for (const notice of raw) {
    const type = VALID_TYPES.includes(notice.type) ? notice.type : 'INFO';
    const group = merged.get(type)!;
    if (notice.title && !group.titles.includes(notice.title)) group.titles.push(notice.title);
    const lines = (notice.text || notice.title || '').split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const clean = line.startsWith('•') ? line : `• ${line}`;
      // 공통 항목 필터링 (예약안내문에 있는 내용 제거)
      if (isCommonNotice(clean)) continue;
      if (!group.bullets.includes(clean)) group.bullets.push(clean);
    }
  }

  // Step 2: 각 type별 1건 생성, 불렛 최대 MAX_BULLETS개
  const result: NoticeItemLocal[] = [];
  for (const type of VALID_TYPES) {
    const group = merged.get(type)!;
    if (group.bullets.length === 0) continue;
    result.push({
      type,
      title: group.titles[0] || (type === 'CRITICAL' ? '본 상품 필수 안내' : type === 'PAYMENT' ? '추가 요금 안내' : type === 'POLICY' ? '이용 규정' : '현지 안내'),
      text: group.bullets.slice(0, MAX_BULLETS).join('\n'),
    });
  }

  return result;
}

// 타입별 색상 매핑
const NOTICE_STYLES: Record<string, { bg: string; border: string; title: string; dot: string }> = {
  CRITICAL: { bg: 'bg-red-50', border: 'border-red-200', title: 'text-red-800', dot: '🔴' },
  PAYMENT:  { bg: 'bg-orange-50', border: 'border-orange-200', title: 'text-orange-800', dot: '🟠' },
  POLICY:   { bg: 'bg-blue-50', border: 'border-blue-200', title: 'text-blue-800', dot: '🔵' },
  INFO:     { bg: 'bg-slate-50', border: 'border-slate-200', title: 'text-slate-700', dot: '⚪' },
};

// ══════════════════════════════════════════════════════════
//  포함/불포함 자동 분류 시스템 (Auto-Classifier)
//  — 어떤 지역/상품이든 동일한 출력 포맷 보장
// ══════════════════════════════════════════════════════════

// Phase 1 CRC — getInclusionIcon / classifyInclusions / flattenItems / BASIC_INC_RE / SURCHARGE_RE
// 모두 render-contract.ts 로 이관됨 (ERR-HSN-render-bundle 근본 해결).
// 렌더러는 view.inclusions.basic (IconizedInclusion[]) / view.inclusions.program 만 소비.

// classifyExcludes / formatSurchargeObject / SurchargeObject 타입은 render-contract.ts로 이관됨 (W1 CRC).
// 이 렌더러에서는 더 이상 직접 파싱하지 않고 view.surchargesMerged / view.excludes.basic 만 소비.

// 포함/불포함 + 추가요금 + 쇼핑 (마지막 페이지)
// W1 CRC — 써차지 병합 / 쇼핑 출처 선택 / 내부메모 차단은 모두 view에서 이미 해결됨 (ERR-KUL-05)
function IncludeExcludeInfo({ view }: {
  view: CanonicalView;
}) {
  // Phase 1 CRC: view.inclusions 에서 이미 basic(iconized) / program 분류 완료.
  // 로컬 classifyInclusions / getInclusionIcon 호출 제거.
  const basicInc = view.inclusions.basic;
  const programInc = view.inclusions.program;
  const basicExc = view.excludes.basic;
  const surchargeLines = view.surchargesMerged;
  const cleanShopping = view.shopping.text;
  if (basicInc.length === 0 && programInc.length === 0 && basicExc.length === 0 && !cleanShopping && surchargeLines.length === 0) return null;

  return (
    <div className="space-y-1.5 mb-1">
      {/* ── 섹션 1: 기본 포함 (아이콘 그리드) ── */}
      {(basicInc.length > 0 || programInc.length > 0) && (
        <section className="bg-blue-50/60 p-2 rounded">
          <h3 className="font-bold text-blue-900 mb-1.5 text-[11px]">포함 사항</h3>
          {basicInc.length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {basicInc.map((item, idx) => (
                <span key={idx} className="text-[11px] text-slate-700 leading-snug break-keep">
                  <span className="text-[10px] mr-0.5">{item.icon}</span>
                  {item.text}
                </span>
              ))}
            </div>
          )}
          {/* 프로그램/특전 항목이 있으면 구분선 아래 컴팩트 표시 */}
          {programInc.length > 0 && (
            <p className={`${basicInc.length > 0 ? 'mt-1.5 pt-1.5 border-t border-blue-100' : ''} text-[10px] text-slate-500 leading-snug break-keep`}>
              ✅ {programInc.join(', ')}
            </p>
          )}
        </section>
      )}

      {/* ── 섹션 2: 기본 불포함 (인라인) ── */}
      {basicExc.length > 0 && (
        <section className="bg-red-50/60 p-2 rounded">
          <h3 className="font-bold text-red-900 mb-1 text-[11px]">불포함 사항</h3>
          <p {...E} className={`text-[11px] text-slate-700 leading-snug break-keep ${EC}`}>
            {basicExc.map((item, idx) => (
              <span key={idx}>
                {idx > 0 && <span className="mx-1 text-slate-300">|</span>}
                {item}
              </span>
            ))}
          </p>
        </section>
      )}

      {/* ── 섹션 3: 추가 요금 (써차지/싱글 등 — 객체 배열 우선, excludes fallback) ── */}
      {surchargeLines.length > 0 && (
        <section className="bg-orange-50/60 p-2 rounded">
          <h3 className="font-bold text-orange-900 mb-1 text-[11px]">💲 추가 요금 안내</h3>
          <div className="space-y-0.5">
            {surchargeLines.map((item, idx) => (
              <p key={idx} className="text-[10px] text-slate-600 leading-snug break-keep">
                • {item.label}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* ── 섹션 4: 쇼핑센터 ── */}
      {cleanShopping && cleanShopping !== '노쇼핑' && (
        <section className="bg-purple-50/60 p-2 rounded">
          <h3 className="font-bold text-purple-900 mb-0.5 text-[11px]">🛍️ 쇼핑센터</h3>
          <p {...E} className={`text-[11px] text-slate-700 leading-snug break-keep ${EC}`}>{cleanShopping}</p>
        </section>
      )}
    </div>
  );
}

// 유의사항 전용 페이지 (Page 1.5)
function NoticesPage({ noticesParsed, customerNotes }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  noticesParsed?: any[]; customerNotes?: string;
}) {
  let typedNotices: NoticeItemLocal[] = [];
  let legacyNotes: string[] = [];

  if (noticesParsed?.length) {
    const first = noticesParsed[0];
    if (typeof first === 'object' && first !== null && 'type' in first) {
      typedNotices = normalizeNotices(noticesParsed as NoticeItemLocal[]);
    } else {
      legacyNotes = noticesParsed as string[];
    }
  } else if (customerNotes) {
    legacyNotes = splitSpecialNotes(customerNotes);
  }

  const TYPE_ORDER: Record<string, number> = { CRITICAL: 0, PAYMENT: 1, POLICY: 2, INFO: 3 };
  if (typedNotices.length > 0) {
    typedNotices.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));
  }

  return (
    <div className="space-y-2">
      {/* 이전 코드의 유의사항 시작 */}

      {/* ═══ 새 형식: 4-Type 2단 그리드 유의사항 ═══ */}
      {typedNotices.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
          <h3 className="font-bold text-[#001f3f] mb-1.5 text-[11px]">예약 시 유의사항</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {typedNotices.map((notice, idx) => {
              const style = NOTICE_STYLES[notice.type] || NOTICE_STYLES.INFO;
              // 불렛 포인트 분리: "• 항목1\n• 항목2" → 개별 라인
              const lines = (notice.text || notice.title || '').split('\n').map(l => l.trim()).filter(Boolean);
              return (
                <div key={idx} className={`${style.bg} border ${style.border} rounded p-2`}>
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-[10px]">{style.dot}</span>
                    <span className={`text-[11px] font-bold ${style.title}`}>{notice.title}</span>
                  </div>
                  <div className="space-y-0.5">
                    {lines.map((line, lIdx) => (
                      <p key={lIdx} {...E} className={`text-[10px] text-slate-600 leading-snug break-keep ${EC}`}>
                        {line.startsWith('•') ? line : `• ${line}`}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
          {/* 법적 방어 문구 */}
          <p className="text-[9px] text-slate-400 mt-1.5 italic">※ 여권, 환불, 취소수수료 등 공통 규정은 별도 발송되는 [예약 안내문]을 반드시 확인하시기 바랍니다.</p>
          </div>
        </div>
      )}

      {/* ═══ 레거시 폴백: 기존 string[] 유의사항 ═══ */}
      {legacyNotes.length > 0 && (() => {
        const SHORT_LIMIT = 40;
        const shortItems = legacyNotes.filter(n => n.length <= SHORT_LIMIT);
        const longItems = legacyNotes.filter(n => n.length > SHORT_LIMIT);
        const leftCol = shortItems.filter((_, i) => i % 2 === 0);
        const rightCol = shortItems.filter((_, i) => i % 2 === 1);

        return (
          <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
            <h3 className="font-bold text-[#001f3f] mb-1.5 text-[11px]">예약 시 유의사항</h3>
            {shortItems.length > 0 && (
              <div className="flex gap-0 mb-1.5">
                <div className="flex-1 space-y-1 pr-3">
                  {leftCol.map((note, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <span className="shrink-0 text-[12px] leading-none mt-0.5">{getNoteEmoji(note)}</span>
                      <p {...E} className={`text-[11px] text-slate-600 leading-snug break-keep ${EC}`}>{note}</p>
                    </div>
                  ))}
                </div>
                <div className="w-px bg-slate-300 shrink-0" />
                <div className="flex-1 space-y-1 pl-3">
                  {rightCol.map((note, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <span className="shrink-0 text-[12px] leading-none mt-0.5">{getNoteEmoji(note)}</span>
                      <p {...E} className={`text-[11px] text-slate-600 leading-snug break-keep ${EC}`}>{note}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {longItems.length > 0 && (
              <div className={`space-y-1.5 ${shortItems.length > 0 ? 'pt-1.5 border-t border-slate-200' : ''}`}>
                {longItems.map((note, idx) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    <span className="shrink-0 text-[12px] leading-none mt-0.5">{getNoteEmoji(note)}</span>
                    <p {...E} className={`text-[11px] text-slate-600 leading-snug break-keep ${EC}`}>{note}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

    </div>
  );
}

// ERR-20260418-04 + ERR-KUL-04 — optional_tours 렌더는 itinerary-render.ts의 normalizeOptionalTourName을 사용
// 이유: A4와 모바일이 동일한 라벨 생성 (region suffix 일관성 보장)
function OptionalTours({ tours }: { tours: OptionalTourInput[] }) {
  const formatPrice = (t: OptionalTourInput): string => {
    if (t.price && String(t.price).trim()) return ` (${String(t.price).trim()})`;
    if (typeof t.price_usd === 'number') return ` ($${t.price_usd})`;
    return '';
  };
  return (
    <section className="mb-2">
      <h3 className="font-bold text-[#001f3f] mb-1 text-[11px]">선택 관광</h3>
      <div className="flex flex-wrap gap-1.5">
        {tours.map((tour, idx) => (
          <span key={idx} {...E} className={`px-1.5 py-0.5 bg-amber-50 text-amber-800 text-[10px] rounded border border-amber-200 font-medium ${EC}`}>
            {normalizeOptionalTourName(tour)}{formatPrice(tour)}
          </span>
        ))}
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════
//  Page 2+ 서브 컴포넌트 (Stitch v2 일정표)
// ══════════════════════════════════════════════════════════

function ItineraryPageHeader({ title, departureAirport, destination, airline, arrivalCity, flightOut }: { title: string; departureAirport?: string; destination?: string; airline?: string; arrivalCity?: string; flightOut?: string }) {
  // 출발 도시 추출
  const depCity = (() => {
    const ap = departureAirport || '';
    if (ap.includes('김해') || ap.includes('부산')) return '부산';
    if (ap.includes('인천') || ap.includes('서울')) return '서울/인천';
    return ap.replace(/국제공항|공항/g, '').trim();
  })();
  // 항공사명 추출 (IATA 코드 → 이름)
  const airlineName = airline ? (getAirlineName(airline) || airline) : null;
  // 직항 도착 도시 (arrivalCity 우선, 없으면 destination 슬래시 첫 번째)
  const directCity = arrivalCity || destination?.split(/[\/,]/)[0]?.trim() || destination;
  // ERR-20260418-13 — 항공 표기 간결화: "BX793(에어부산) 부산 → 타이페이"
  const flightLabel = (() => {
    const parts: string[] = [];
    if (flightOut) parts.push(flightOut);
    if (airlineName) parts.push(`(${airlineName})`);
    return parts.join('');
  })();

  return (
    <header className="w-full border-b border-[#005d90] flex justify-between items-center px-10 py-3">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="여소남" className="h-6 object-contain shrink-0" />
        <h1 {...E} className={`text-[16px] font-bold text-[#005d90] ${EC}`}>
          {title}
        </h1>
      </div>
      {depCity && directCity && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[13px] font-bold text-blue-800 bg-blue-50 border border-blue-200 rounded-full">
          ✈️ {flightLabel ? `${flightLabel} ` : ''}{depCity} → {directCity}
        </span>
      )}
    </header>
  );
}


// AIRLINE_MAP / getAirlineName 은 render-contract.ts로 이관됨 (W1 CRC).
// ItineraryPageHeader 등 이 파일 내부 사용처는 파일 상단 import에서 해결.

// 활동 타입별 dot 색상
function getDotColor(type?: string): string {
  switch (type) {
    case 'flight': return 'bg-blue-500 ring-blue-200';
    case 'golf': return 'bg-green-600 ring-green-200';
    case 'cruise': return 'bg-cyan-500 ring-cyan-200';
    case 'spa': return 'bg-pink-400 ring-pink-200';
    case 'excursion': return 'bg-teal-500 ring-teal-200';
    case 'shopping': return 'bg-amber-500 ring-amber-200';
    case 'meal': return 'bg-orange-400 ring-orange-200';
    case 'hotel': return 'bg-indigo-400 ring-indigo-200';
    case 'optional': return 'bg-purple-400 ring-purple-200';
    default: return 'bg-emerald-500 ring-emerald-200';
  }
}

// 6종 배지 체계: 관광, 쇼핑, 특전, 선택관광, 골프, 특식
// - 관광: attractions DB 매칭 시에만 (type:normal + DB 매칭)
// - 특전: 스파/크루즈/마사지/루프탑/체험 등 통합
// - 나머지: type 기반
// ── 타임라인 항목 분류 유틸 (비교통 항목 전용) ───────────────
// 동선 노드 — 📍 포함 or → 2개 이상
function isRouteNode(item: { time?: string | null; activity: string; note?: string | null }): boolean {
  const a = item.activity || '';
  if (a.includes('📍')) return true;
  const arrowCount = (a.match(/→/g) || []).length;
  return arrowCount >= 2;
}

// 단순 지역명 노드 — 시간/설명/note 없이 지역명만 (DayHeader에 중복 표시됨)
// 주의: "이동"/"관광"/"체크" 등 동사가 포함된 항목은 제거 대상 아님
function isBareRegionNode(item: { time?: string | null; activity: string; note?: string | null }): boolean {
  if (item.time) return false;
  if (item.note) return false;
  const a = (item.activity || '').trim();
  if (!a) return false;
  // 동사/활동 키워드가 있으면 지역명 아님
  if (/이동|관광|도착|출발|체크|휴식|조식|중식|석식|투숙|방문|참석|체험/.test(a)) return false;
  return /^[가-힣\s/]{1,10}$/.test(a);
}

// 특전 키워드 — ★, 증정, 1인 1개, 특전, 이모지+특전 복합
// 예외: 골프★, 차창 포함 항목은 특전 아님
function isSpecialBenefit(item: { activity: string }): boolean {
  const a = item.activity || '';
  if (/골프★/.test(a)) return false;
  if (/차창/.test(a)) return false;
  if (/★/.test(a)) return true;
  if (/증정/.test(a)) return true;
  if (/1인\s*1개/.test(a)) return true;
  if (/^\s*특전/.test(a)) return true;
  if (/[♨️🎁✨💎]\s*특전/.test(a)) return true;
  return false;
}

// 준비/대기 성격 — 집결, 승선, 대기, 선내 휴식
function isPreparationNode(item: { activity: string }): boolean {
  return /집결|승선|대기|선내\s*휴식/.test(item.activity || '');
}

function getActivityBadge(type?: string, activity?: string): { bg: string; text: string; border: string; label: string } | null {
  switch (type) {
    case 'optional': return { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-100', label: '선택관광' };
    case 'shopping': return { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-100', label: '쇼핑' };
    case 'golf': return { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-100', label: '골프' };
    case 'meal': return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', label: '특식' };
    case 'cruise': case 'spa': case 'excursion':
      return { bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-100', label: '특전' };
    default: break;
  }
  // ERR-20260418-30 — "체험" 단일 키워드는 너무 광범위해서 제거 (카지노 체험 = 특전 오판정)
  // ERR-HET-activity-badge-paren-leak@2026-04-22 — "▶춘쿤산 관광 (...전망대관람 포함)" 처럼
  // 괄호 안 부연설명에 우연히 "전망대" 가 들어있으면 특전 배지 오판정. 괄호 안은 제외하고 검사.
  const core = activity ? activity.replace(/\s*\([^)]*\)\s*/g, ' ').trim() : '';
  if (core && /루프탑|크루즈|요트|스파|전망대|쇼\s/.test(core)) {
    return { bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-100', label: '특전' };
  }
  return null;
}
function getAttractionBadge(badgeType?: string) {
  switch (badgeType) {
    case 'special': return { bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-100', label: '특전' };
    case 'shopping': return { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-100', label: '쇼핑' };
    case 'meal': return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', label: '특식' };
    case 'tour': default: return null; // 일반 관광지는 배지 없이 텍스트만 표시
  }
}

// activity 텍스트에서 관광지명과 괄호 설명 분리
function splitPoi(activity: string): { poiName: string; poiDesc: string } {
  const match = activity.match(/^(.+?)(\s*\(.*\)\s*)$/);
  return match ? { poiName: match[1], poiDesc: match[2] } : { poiName: activity, poiDesc: '' };
}

/** 일정표 — v3: 타임라인 dot + 관광지 하이라이트 배지 */
function DailyItinerary({ days, attractions, destination }: { days: DaySchedule[]; attractions?: AttractionInfo[]; destination?: string }) {
  // ══ 통합 교통 파서: 전체 days 한 번에 처리 (ship cross-day pair 포함) ══
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsedDays = parseDaysWithTransport(days as any);

  // ERR-HET-a4-shortdesc-duplicate@2026-04-22 — A4 포스터에서 같은 관광지에 매칭된 여러 activity 마다
  // `— {attr.short_desc}` 가 반복 노출 (예: 시라무런 초원 5회). 전체 일정에 걸쳐 **첫 매칭 activity 에만**
  // short_desc 를 렌더. 모바일 DetailClient 의 seenAttractionIds 와 동일한 글로벌 dedup.
  const seenAttractionIdsForDesc = new Set<string>();

  return (
    <section className="space-y-3">
      {parsedDays.map((dayRaw) => {
        const day = dayRaw as unknown as DaySchedule & { parsedSchedule: import('@/lib/transportParser').ParsedScheduleItem[] };
        const parsedSchedule = day.parsedSchedule;

        // ── 동선 노드 분리 (항상 최상단 배지로 렌더) ──
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const routeNodes = parsedSchedule.filter(s => !isTransportSegment(s)).filter(isRouteNode as any);

        // ── 통합 타임라인 생성: 교통 바 + 일반 항목을 time 기준 오름차순 통합 ──
        // 동선 노드 / 단순 지역명은 제외
        const unifiedEntries = parsedSchedule.filter(s => {
          if (isTransportSegment(s)) return true;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (isRouteNode(s as any)) return false;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (isBareRegionNode(s as any)) return false;
          return true;
        });

        // 원본 배열 순서 그대로 유지 (parseDaysWithTransport가 이미 올바른 순서 생성)
        // 절대 전체 재정렬 하지 말 것 — time 없는 항목이 뒤로 밀리는 버그 방지
        const unifiedTimeline = unifiedEntries;

        return (
          <div key={day.day} className="flex gap-3">
            {/* 좌측: 일차 숫자 */}
            <div className="w-12 shrink-0 text-center pt-0.5">
              <span className="text-3xl font-extrabold text-[#005d90] block leading-none">
                {String(day.day).padStart(2, '0')}
              </span>
              <span className="text-[13px] font-bold text-[#8e4e14] tracking-tight">
                {day.day}일차
              </span>
            </div>

            {/* 우측: 카드 */}
            <div className="flex-1 bg-slate-50/80 rounded-xl p-3 border border-slate-200">
              {/* [1] 동선 배지 — 항상 최상단 고정 */}
              <div className="mb-2 pb-1.5 border-b border-slate-200">
                {routeNodes.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {routeNodes.map((n, i) => (
                      <span key={i} className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-[13px] font-semibold px-2 py-1 rounded">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        🗺️ {((n as any).activity || '').replace(/^📍\s*/, '')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <h3 {...E} className={`text-[15px] font-bold text-[#001f3f] flex items-center gap-1.5 break-keep ${EC}`}>
                    📍 {day.regions?.join(' → ') || `${day.day}일차 일정`}
                  </h3>
                )}
              </div>

              {/* [2] 통합 타임라인: 교통 바 + 일반 항목 시간순 */}
              {unifiedTimeline.length > 0 && (() => {
                // ── 선택관광/쇼핑 항목을 본 타임라인에서 분리 ──
                const normalItems: typeof unifiedTimeline = [];
                const optionalItems: { activity: string }[] = [];
                for (const entry of unifiedTimeline) {
                  if (isTransportSegment(entry)) { normalItems.push(entry); continue; }
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const item = entry as any;
                  if (item.type === 'optional') { optionalItems.push(item); continue; }
                  if (item.type === 'shopping') continue; // Fix 5: 쇼핑은 일정에서 제거
                  normalItems.push(entry);
                }

                return <>
                <div className="relative border-l-2 border-slate-200 ml-2 space-y-1.5 pb-0.5">
                  {normalItems.map((entry, sIdx) => {
                    // TransportBar 렌더
                    if (isTransportSegment(entry)) {
                      return (
                        <div key={sIdx} className="relative pl-4 -ml-0.5">
                          <TransportBar segment={entry} />
                        </div>
                      );
                    }
                    // 일반 ScheduleItem 렌더
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const item = entry as any;
                    // ERR-20260418-25/32 — optional/shopping 포함 매칭 스킵 강화
                    const skipAttrMatch =
                      item.type === 'flight' || item.type === 'hotel' || item.type === 'optional' || item.type === 'shopping' ||
                      /공항|출발|도착|이동|수속|탑승|귀환|체크인|체크아웃|투숙|휴식|미팅|추천|선택관광/.test(item.activity || '');
                    const attr = skipAttrMatch ? null : matchAttraction(item.activity, attractions, destination);
                    const isSpecial = isSpecialBenefit(item);
                    const isPrep = isPreparationNode(item);
                    const badge = isSpecial
                      ? { bg: 'bg-[#fff0ed]', text: 'text-[#c0392b]', border: 'border-transparent', label: '특전' }
                      : (attr ? getAttractionBadge(attr.badge_type) : (isPrep ? null : getActivityBadge(item.type, item.activity)));
                    const dotColor = isPrep ? 'bg-slate-300' : getDotColor(item.type);
                    return (
                      <div key={sIdx} className="relative pl-4">
                        <div className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ring-2 border-2 border-white ${dotColor}`} />
                        <div className="flex flex-col">
                          <span className={`text-[13px] break-keep leading-snug flex flex-wrap items-center gap-1 ${EC}`}>
                            {item.time && <span className="text-blue-600 font-bold">{item.time}</span>}
                            {badge ? (() => {
                              // ERR-HET-activity-desc-duplicate@2026-04-22 — displayName 에 activity 전체(괄호 포함)를
                              // 넣고 displayDesc 에도 poiDesc(괄호) 를 또 넣으면 **괄호 내용이 2번** 노출됨.
                              // attractions 매칭 실패(춘쿤산 등)한 ▶관광지에서 재현. splitPoi 로 이름·설명 분리.
                              const { poiName, poiDesc } = splitPoi(item.activity);
                              // attr 또는 특전: 전체 activity 를 그대로 이름으로 (부연 분리 안 함)
                              // 일반 ▶관광지(매칭 실패): 이름은 괄호 앞, 부연은 괄호 안만
                              const displayName = (attr || isSpecial) ? item.activity : poiName;
                              const displayDesc = (!attr && !isSpecial && poiDesc) ? poiDesc : null;
                              return <>
                                {isSpecial && <span>🎁</span>}
                                {!isSpecial && attr?.emoji && <span>{attr.emoji}</span>}
                                <span className={`${badge.bg} ${badge.text} ${isSpecial ? 'font-semibold rounded-md px-2 py-0.5' : `border ${badge.border} px-1.5 py-0.5 rounded font-bold`} text-[11px]`}>
                                  {badge.label}
                                </span>
                                <span {...E} className="font-black text-[15px] text-blue-900">{displayName}</span>
                                {displayDesc && <span className="text-[12px] text-gray-500 font-normal">{displayDesc}</span>}
                              </>;
                            })() : <span {...E} className={`font-bold ${isPrep ? 'text-slate-500' : 'text-slate-800'}`}>{item.activity}</span>}
                            {(() => {
                              if (!attr?.short_desc || !attr.name) return null;
                              if (seenAttractionIdsForDesc.has(attr.name)) return null;
                              seenAttractionIdsForDesc.add(attr.name);
                              return (
                                <span className="text-[12px] text-slate-500 font-normal"> — {attr.short_desc}</span>
                              );
                            })()}
                            {item.note && (
                              <span className="text-[12px] text-red-500 font-medium">({item.note})</span>
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Fix 2: 선택관광 묶음 — 레이블 1번 + 항목 나열 */}
                {optionalItems.length > 0 && (
                  <div className="mt-1.5 bg-pink-50/60 rounded-lg border border-pink-100 px-2.5 py-1.5">
                    <span className="text-[11px] font-bold text-pink-700">💎 선택관광</span>
                    <div className="mt-1 space-y-0.5">
                      {optionalItems.map((opt, oIdx) => {
                        const text = opt.activity.replace(/^\[.*?\]\s*/, '').replace(/^☆\s*/, '');
                        if (!text || text.startsWith('☆')) return null;
                        return <p key={oIdx} className="text-[11px] text-slate-700 leading-snug">• {text}</p>;
                      })}
                    </div>
                  </div>
                )}
                </>;
              })()}

              {/* 하단: 숙박 + 식사 (1줄 통합, 호텔명 길면 2줄) */}
              {(() => {
                // Fix 4: 호텔 null 시 상황별 분기
                const schedule = day.schedule || [];
                const hasFlight = schedule.some((s: { type?: string }) => s.type === 'flight');
                const hasAirportMove = schedule.some((s: { activity?: string }) => /공항.*이동|공항으로/.test(s.activity || ''));
                const isLastDay = day.day === days[days.length - 1]?.day;
                const isFirstDay = day.day === days[0]?.day;

                let hotelText: string;
                let hotelIcon = '🏨';
                let hideHotel = false;

                if (day.hotel?.name) {
                  hotelText = `${day.hotel.name}${day.hotel.grade ? ` (${day.hotel.grade})` : ''}${day.hotel.note ? ` ${day.hotel.note}` : ''}`;
                } else if (isLastDay && hasFlight) {
                  // 마지막 날 귀국일 → 호텔 행 숨김
                  hideHotel = true;
                  hotelText = '';
                } else if (hasFlight && isFirstDay) {
                  // 첫날 심야 출발 → 기내 숙박
                  hotelIcon = '✈️';
                  hotelText = '기내 숙박';
                } else if (hasAirportMove) {
                  // 공항 이동 후 출발 대기
                  hotelIcon = '🏢';
                  hotelText = '공항 대기';
                } else {
                  hotelText = '숙박 없음';
                }
                if (hideHotel) return null;
                const mealB = day.meals?.breakfast_note || (day.meals?.breakfast ? '호텔식' : '불포함');
                const mealL = day.meals?.lunch_note || (day.meals?.lunch ? '현지식' : '불포함');
                const mealD = day.meals?.dinner_note || (day.meals?.dinner ? '현지식' : '불포함');
                const isLong = hotelText.length > 25;
                return (
                  <div className="mt-2 bg-white rounded-lg border border-slate-200 px-2 py-1.5">
                    {isLong ? (
                      <>
                        <div className="flex items-center gap-1 text-[13px] font-semibold text-slate-800">
                          {hotelIcon} <span {...E} className={EC}>{hotelText}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-slate-600 mt-0.5">
                          <span>☕{mealB}</span><span className="text-slate-300">|</span>
                          <span>🍜{mealL}</span><span className="text-slate-300">|</span>
                          <span>🍽️{mealD}</span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between text-[13px]">
                        <div className="flex items-center gap-1 font-semibold text-slate-800">
                          {hotelIcon} <span {...E} className={EC}>{hotelText}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-slate-500 shrink-0">
                          <span>☕{mealB}</span><span className="text-slate-300">|</span>
                          <span>🍜{mealL}</span><span className="text-slate-300">|</span>
                          <span>🍽️{mealD}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })}
    </section>
  );
}

// ══════════════════════════════════════════════════════════
//  A4 전용 약관 페이지 (4-level 해소 후 critical 축약 + QR)
// ══════════════════════════════════════════════════════════
function ResolvedNoticesA4Page({ notices, packageId }: {
  notices: NoticeBlock[];
  packageId?: string;
}) {
  // A4 공간 제약: severity='critical' 만 노출, 나머지는 QR로 유도
  const critical = notices.filter(n => (n.severity ?? 'standard') === 'critical');
  const hasSpecial = notices.some(n => (n._tier ?? 1) >= 3);

  // QR: 모바일 약관 페이지 (상품 상세 #유의사항 앵커)
  // NEXT_PUBLIC_BASE_URL 우선 — admin 도메인에서 프리뷰 시에도 고객 접근 가능한 URL 고정 보장.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://yeosonam.com';
  const termsUrl = packageId ? `${baseUrl}/packages/${packageId}#유의사항` : `${baseUrl}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=${encodeURIComponent(termsUrl)}`;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded p-2.5">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex-1">
          <h3 className="font-bold text-[#001f3f] text-[11px]">예약 시 유의사항 · 특별약관</h3>
          {hasSpecial && (
            <p className="text-[9px] font-bold text-red-600 mt-0.5">
              ※ 본 상품은 특별약관이 적용되며 표준약관보다 우선 적용됩니다.
            </p>
          )}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrUrl} alt="약관 전문 QR" width={70} height={70} className="shrink-0 border border-slate-300 rounded" />
      </div>

      {critical.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-1.5">
          {critical.map((notice, idx) => {
            const lines = (notice.text || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 4);
            return (
              <div key={idx} className="bg-white border border-red-200 rounded p-1.5">
                <div className="flex items-center gap-1 mb-0.5">
                  <span className={`text-[11px] font-bold text-red-700`}>{notice.title}</span>
                  {(notice._tier ?? 1) >= 3 && notice._source && (
                    <span className="text-[8px] font-bold text-red-500 bg-red-50 px-1 rounded">[{notice._source}]</span>
                  )}
                </div>
                <div className="space-y-0.5">
                  {lines.map((line, lIdx) => (
                    <p key={lIdx} className="text-[9px] text-slate-600 leading-tight break-keep">
                      {line.startsWith('•') ? line : `• ${line}`}
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[9px] text-slate-500 italic border-t border-slate-200 pt-1 mt-1">
        ※ 여권/비자·결제·책임·쇼핑환불 등 표준 약관 전문은 우측 QR 또는 별도 발송되는 [예약 안내문]을 반드시 확인하시기 바랍니다.
      </p>
    </div>
  );
}
