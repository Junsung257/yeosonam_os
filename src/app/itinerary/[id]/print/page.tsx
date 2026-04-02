import PrintBar from './PrintBar';
import { createClient } from '@supabase/supabase-js';
import type { TravelItinerary } from '@/types/itinerary';
import type { PriceListItem } from '@/lib/parser';
import {
  PosterHeader,
  PosterPrice,
  PosterInfo,
  PosterScheduleTable,
  PosterFooter,
  PosterMiniHeader,
  calcPage1DayCount,
  estimateHeights,
  type PriceTier,
} from '@/components/itinerary/A4PosterLayout';

// ── Supabase 서버사이드 클라이언트 (Service Role — RLS 우회) ────────────────
function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function loadPackage(id: string) {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('travel_packages')
    .select('id, title, itinerary_data, price_tiers, price_list, single_supplement, guide_tip, excluded_dates')
    .eq('id', id)
    .single();
  return data as {
    id: string;
    title: string;
    itinerary_data: TravelItinerary | null;
    price_tiers: PriceTier[] | null;
    price_list: PriceListItem[] | null;
    single_supplement: string | null;
    guide_tip: string | null;
    excluded_dates: string[] | null;
  } | null;
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
  const priceTiers = pkg.price_tiers ?? [];
  const priceList = pkg.price_list ?? [];
  const excludedDates = pkg.excluded_dates ?? [];
  const days = itinerary.days ?? [];

  // 높이 기반 자동 페이지 분배
  const priceListRowCount = priceList.length > 0
    ? priceList.reduce((sum, p) => sum + p.rules.length, 0)
    : 0;

  const { headerH, priceH, infoH, footerH } = estimateHeights(itinerary, priceTiers.length, priceListRowCount);
  const page1DayCount = calcPage1DayCount(days, headerH, priceH, infoH, footerH);
  const page1Days = days.slice(0, page1DayCount);
  const page2Days = days.slice(page1DayCount);

  // 선택관광 목록
  const optTours = itinerary.optional_tours ?? [];

  return (
    <>
      <PrintBar title={itinerary.meta.title} />

      <div
        className="print:bg-white bg-gray-300 min-h-screen print:min-h-0 flex flex-col items-center py-8 print:py-0 gap-6 print:gap-0"
      >
        {/* ══════ Page 1: 요금표 + 포함불포함 + 일정표(앞부분) ══════ */}
        <A4Page>
          <PosterHeader meta={itinerary.meta} />

          <PosterPrice
            meta={itinerary.meta}
            priceTiers={priceTiers.length > 0 ? priceTiers : undefined}
            priceList={priceList.length > 0 ? priceList : undefined}
            highlightDate={departureDate}
            excludedDates={excludedDates}
            singleSupplement={pkg.single_supplement}
            guideTip={pkg.guide_tip}
          />

          <PosterInfo highlights={itinerary.highlights} />

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

          <PosterFooter />
        </A4Page>

        {/* ══════ Page 2: 나머지 일정 + 선택관광 (필요한 경우만) ══════ */}
        {page2Days.length > 0 && (
          <A4Page>
            <PosterMiniHeader title={itinerary.meta.title} />

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

            <PosterFooter />
          </A4Page>
        )}

      </div>
    </>
  );
}
