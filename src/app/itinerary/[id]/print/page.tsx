import PrintBar from './PrintBar';
import { createClient } from '@supabase/supabase-js';
import type { DaySchedule, TravelItinerary } from '@/types/itinerary';
import type { PriceListItem } from '@/lib/parser';
import { renderPackage } from '@/lib/render-contract';
import { getLegalNoticeLinesOrDefault } from '@/lib/legal-notice';
import {
  PosterHeader,
  PosterPrice,
  PosterInfo,
  PosterLegalNotice,
  PosterScheduleTable,
  PosterFooter,
  PosterMiniHeader,
  calcPage1DayCount,
  estimateHeights,
  type PriceTier,
} from '@/components/itinerary/A4PosterLayout';
import { getSecret } from '@/lib/secret-registry';

// ── Supabase 서버사이드 클라이언트 (Service Role — RLS 우회) ────────────────
function getSupabase() {
  const url = getSecret('NEXT_PUBLIC_SUPABASE_URL');
  const key = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key);
}

async function loadPackage(id: string) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('travel_packages')
    .select('id, title, destination, airline, departure_airport, itinerary_data, price_tiers, price_list, single_supplement, guide_tip, excluded_dates, excludes, surcharges, optional_tours, customer_notes, internal_notes, inclusions')
    .eq('id', id)
    .single();
  return data as {
    id: string;
    title: string;
    destination: string | null;
    airline: string | null;
    departure_airport: string | null;
    itinerary_data: TravelItinerary | null;
    price_tiers: PriceTier[] | null;
    price_list: PriceListItem[] | null;
    single_supplement: string | null;
    guide_tip: string | null;
    excluded_dates: string[] | null;
    excludes: string[] | null;
    surcharges: {
      name?: string;
      start?: string;
      end?: string;
      amount?: number;
      currency?: string;
      unit?: string;
    }[] | null;
    optional_tours: {
      name: string;
      price_usd?: number | null;
      price_krw?: number | null;
      note?: string | null;
    }[] | null;
    customer_notes: string | null;
    internal_notes: string | null;
    inclusions: string[] | null;
  } | null;
}

function toPosterDays(days: ReturnType<typeof renderPackage>['days']): DaySchedule[] {
  return days.map((d) => ({
    day: d.day,
    regions: d.regions,
    meals: {
      breakfast: !!d.meals?.breakfast,
      lunch: !!d.meals?.lunch,
      dinner: !!d.meals?.dinner,
      breakfast_note: d.meals?.breakfast_note ?? null,
      lunch_note: d.meals?.lunch_note ?? null,
      dinner_note: d.meals?.dinner_note ?? null,
    },
    schedule: d.schedule.map((s) => ({
      time: s.time ?? null,
      activity: s.activity ?? '',
      transport: s.transport ?? null,
      note: s.note ?? null,
      type: (s.type as DaySchedule['schedule'][number]['type']) ?? 'normal',
    })),
    hotel: d.hotelCard
      ? {
          name: d.hotelCard.name ?? '',
          grade: d.hotelCard.grade ?? null,
          note: d.hotelCard.note ?? null,
        }
      : null,
  }));
}

function parseTourPrices(price: string | null): { price_usd: number | null; price_krw: number | null } {
  if (!price) return { price_usd: null, price_krw: null };
  const usd = price.match(/\$([0-9]+(?:\.[0-9]+)?)/);
  const krw = price.match(/([0-9][0-9,]*)\s*원/);
  return {
    price_usd: usd ? Number(usd[1]) : null,
    price_krw: krw ? Number(krw[1].replace(/,/g, '')) : null,
  };
}

// ── A4 페이지 컨테이너 ────────────────────────────────────────────────────
function A4Page({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative bg-white overflow-hidden print:shadow-none shadow-2xl"
      style={{
        width: '794px',
        minHeight: '1123px',
        maxHeight: '1123px',
        padding: '34px 36px',
        pageBreakAfter: 'always',
        fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif",
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {children}
      </div>
    </div>
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
  const departureDate = searchParams.date || null;

  const pkg = await loadPackage(params.id);
  if (!pkg || !pkg.itinerary_data) {
    // itinerary_data 없으면 빈 안내
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <p className="text-lg font-bold text-gray-700 mb-2">일정표 데이터 없음</p>
          <p className="text-sm text-gray-400">상품 ID: {params.id}</p>
        </div>
      </div>
    );
  }

  const itinerary = pkg.itinerary_data;
  const view = renderPackage(pkg);
  const priceTiers = pkg.price_tiers ?? [];
  const priceList = pkg.price_list ?? [];
  const excludedDates = pkg.excluded_dates ?? [];
  const days = toPosterDays(view.days);
  const itineraryForRender: TravelItinerary = {
    ...itinerary,
    meta: {
      ...itinerary.meta,
      airline: view.airlineHeader.airlineLabel ?? itinerary.meta.airline,
    },
    highlights: {
      ...itinerary.highlights,
      inclusions: view.inclusions.flat.length > 0 ? view.inclusions.flat : itinerary.highlights.inclusions,
      excludes: view.excludes.basic.length > 0 ? view.excludes.basic : itinerary.highlights.excludes,
      shopping: view.shopping.text ?? itinerary.highlights.shopping,
    },
    days,
    optional_tours: view.optionalTours.flat.length > 0
      ? view.optionalTours.flat.map((t) => ({
          name: t.name,
          ...parseTourPrices(t.price),
          note: t.note ?? null,
        }))
      : itinerary.optional_tours,
  };

  // 높이 기반 자동 페이지 분배
  const priceListRowCount = priceList.length > 0
    ? priceList.reduce((sum, p) => sum + p.rules.length, 0)
    : 0;

  const { headerH, priceH, infoH, footerH } = estimateHeights(itineraryForRender, priceTiers.length, priceListRowCount);
  const page1DayCount = calcPage1DayCount(days, headerH, priceH, infoH, footerH);
  const page1Days = days.slice(0, page1DayCount);
  const page2Days = days.slice(page1DayCount);

  // 선택관광 목록
  const optTours = itineraryForRender.optional_tours ?? [];
  const legalNotices = getLegalNoticeLinesOrDefault(itineraryForRender.highlights.remarks ?? [], 3);

  return (
    <>
      <PrintBar title={itinerary.meta.title} />

      <div
        className="print:bg-white bg-gray-300 min-h-screen print:min-h-0 flex flex-col items-center py-8 print:py-0 gap-6 print:gap-0"
      >
        {/* ══════ Page 1: 요금표 + 포함불포함 + 일정표(앞부분) ══════ */}
        <A4Page>
          <PosterHeader meta={itineraryForRender.meta} />

          <PosterPrice
            meta={itineraryForRender.meta}
            priceTiers={priceTiers.length > 0 ? priceTiers : undefined}
            priceList={priceList.length > 0 ? priceList : undefined}
            highlightDate={departureDate}
            excludedDates={excludedDates}
            singleSupplement={pkg.single_supplement}
            guideTip={pkg.guide_tip}
          />

          <PosterInfo highlights={itineraryForRender.highlights} />

          {/* 일정 테이블 (페이지1에 들어가는 만큼) */}
          {page1Days.length > 0 && (
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: '11px', fontWeight: 700, color: '#374151',
                marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                <span style={{
                  width: '3px', height: '12px', background: '#1a3764',
                  borderRadius: '1px', display: 'inline-block', flexShrink: 0,
                }} />
                상세 일정표
              </div>
              <PosterScheduleTable days={page1Days} departureDate={departureDate} />

              {/* 1페이지 완결 시 선택관광도 여기에 */}
              {page2Days.length === 0 && optTours.length > 0 && (
                <div style={{
                  marginTop: '6px', border: '1px solid #fed7aa', borderRadius: '4px',
                  background: '#fffbeb', padding: '4px 8px', fontSize: '9.5px',
                }}>
                  <span style={{ fontWeight: 700, color: '#c2410c', marginRight: '6px' }}>
                    선택관광 (별도판매가)
                  </span>
                  {optTours.map((t, i) => (
                    <span key={i} style={{ color: '#374151', marginRight: '8px' }}>
                      ▪ {t.name}
                      {t.price_usd ? ` $${t.price_usd}` : ''}
                      {t.price_krw ? ` ₩${t.price_krw.toLocaleString()}` : ''}
                      {t.note ? ` (${t.note})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <PosterLegalNotice notices={legalNotices} />
          <PosterFooter />
        </A4Page>

        {/* ══════ Page 2: 나머지 일정 + 선택관광 (필요한 경우만) ══════ */}
        {page2Days.length > 0 && (
          <A4Page>
            <PosterMiniHeader title={itineraryForRender.meta.title} />

            <div style={{ flex: 1 }}>
              <PosterScheduleTable
                days={page2Days}
                departureDate={departureDate}
              />

              {/* 선택관광 */}
              {optTours.length > 0 && (
                <div style={{
                  marginTop: '8px', border: '1px solid #fed7aa', borderRadius: '4px',
                  background: '#fffbeb', padding: '4px 8px', fontSize: '9.5px',
                }}>
                  <span style={{ fontWeight: 700, color: '#c2410c', marginRight: '6px' }}>
                    선택관광 (별도판매가)
                  </span>
                  {optTours.map((t, i) => (
                    <span key={i} style={{ color: '#374151', marginRight: '8px' }}>
                      ▪ {t.name}
                      {t.price_usd ? ` $${t.price_usd}` : ''}
                      {t.price_krw ? ` ₩${t.price_krw.toLocaleString()}` : ''}
                      {t.note ? ` (${t.note})` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <PosterLegalNotice notices={legalNotices} />
            <PosterFooter />
          </A4Page>
        )}

      </div>
    </>
  );
}
