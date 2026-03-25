'use client';

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
  schedule?: { time?: string | null; activity: string; transport?: string | null; type?: string; badge?: string | null }[];
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
  emoji?: string;
}

export interface YeosonamA4Props {
  pkg: {
    title?: string;
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
    optional_tours?: { name: string; price_usd?: number }[];
    itinerary_data?: TravelItinerary;
    special_notes?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    notices_parsed?: any[];
    excluded_dates?: string[];
    product_type?: string;
    product_highlights?: string[];
  };
  attractions?: AttractionInfo[];
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

// 관광지 매칭: activity 텍스트에서 attraction name을 찾아 매칭
function matchAttraction(activity: string, attractions?: AttractionInfo[]): AttractionInfo | null {
  if (!attractions?.length) return null;
  // 정확 매칭 우선, 그다음 포함 매칭
  return attractions.find(a => activity === a.name)
    || attractions.find(a => activity.includes(a.name))
    || attractions.find(a => a.name.length >= 3 && activity.includes(a.name))
    || null;
}

export default function YeosonamA4Template({ pkg, attractions }: YeosonamA4Props) {
  if (!pkg) return <div style={PAGE_STYLE} className="a4-export-page animate-pulse bg-gray-50" />;

  const title = pkg.display_name || pkg.title || '상품명';
  const itinerary = pkg.itinerary_data;
  const days = itinerary?.days || [];
  // 동적 DAYS_PER_PAGE: 일수에 따라 조절
  const daysPerPage = days.length <= 4 ? 4 : days.length <= 6 ? 5 : DEFAULT_DAYS_PER_PAGE;
  const dayChunks = chunkArray(days, daysPerPage);

  // 뱃지 공통
  const badgesContent = <>
    {pkg.destination && <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded font-semibold">{pkg.destination}</span>}
    {pkg.duration && <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded font-semibold">{pkg.duration}일</span>}
    {pkg.airline && <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded font-semibold">{pkg.airline}</span>}
    {pkg.departure_airport && <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded font-semibold">{pkg.departure_airport} 출발</span>}
    {(pkg.min_participants || itinerary?.meta?.min_participants) && <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-xs rounded font-semibold">최소 {pkg.min_participants || itinerary?.meta?.min_participants}명</span>}
    {pkg.product_type && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded font-semibold">{pkg.product_type}</span>}
    {pkg.ticketing_deadline && <span className="px-2 py-0.5 bg-red-50 text-red-600 text-xs rounded font-bold border border-red-200">{pkg.ticketing_deadline}까지 발권</span>}
    {pkg.departure_days && <span className="text-[11px] text-slate-500">출발: {pkg.departure_days}</span>}
  </>;

  // 유의사항 분리 판단: 요금행 8개 초과이면 별도 페이지, 아니면 Page 1에 포함
  const priceRowCount = (pkg.price_list?.length ?? 0) > 0
    ? pkg.price_list!.reduce((sum, g) => sum + g.rules.length, 0)
    : (pkg.price_tiers?.length ?? 0);
  const hasNotices = (pkg.notices_parsed?.length ?? 0) > 0 || pkg.special_notes;
  const noticesOnSeparatePage = hasNotices && priceRowCount > 8;

  return (
    <div className="flex flex-col items-center gap-10">
      {/* ═══ PAGE 1: 요금표 + 포함/불포함 + (공간 여유 시 유의사항) ═══ */}
      <article className="a4-export-page" style={PAGE_STYLE}>
        <Page1Header title={title} badges={badgesContent} />
        <main className="flex-1 px-10 pb-3 text-[#0b1c30]">
          <PriceTable priceList={pkg.price_list} tiers={pkg.price_tiers} excludedDates={pkg.excluded_dates} />
          {(pkg.optional_tours?.length ?? 0) > 0 && <OptionalTours tours={pkg.optional_tours!} />}
          <IncludeExcludeInfo
            inclusions={pkg.inclusions || itinerary?.highlights?.inclusions}
            excludes={pkg.excludes || itinerary?.highlights?.excludes}
          />
          {/* 요금행이 적으면 유의사항도 Page 1에 포함 */}
          {!noticesOnSeparatePage && hasNotices && (
            <NoticesPage noticesParsed={pkg.notices_parsed} specialNotes={pkg.special_notes} />
          )}
        </main>
        <Page1Footer />
      </article>

      {/* ═══ PAGE 1.5: 유의사항 별도 페이지 (요금행 8개 초과 시) ═══ */}
      {noticesOnSeparatePage && (
        <article className="a4-export-page" style={PAGE_STYLE}>
          <Page1Header title={title} badges={<span className="text-[11px] text-slate-500">예약 유의사항</span>} />
          <main className="flex-1 px-10 pb-3 text-[#0b1c30]">
            <NoticesPage
              noticesParsed={pkg.notices_parsed}
              specialNotes={pkg.special_notes}
            />
          </main>
          <Page1Footer />
        </article>
      )}

      {/* ═══ PAGE 2+: 일정 (Stitch v2 디자인) ═══ */}
      {dayChunks.map((chunk, chunkIdx) => (
        <article key={chunkIdx} className="a4-export-page" style={PAGE_STYLE}>
          <ItineraryPageHeader
            title={title}
            departureAirport={pkg.departure_airport}
            destination={pkg.destination}
          />
          <div className="flex-1 px-10 pb-8">
            <DailyItinerary days={chunk} attractions={attractions} />
          </div>
          <ItineraryPageFooter />
        </article>
      ))}

      {/* 일정 없으면 빈 페이지 */}
      {days.length === 0 && (
        <article className="a4-export-page" style={PAGE_STYLE}>
          <ItineraryPageHeader title={title} />
          <div className="flex-1 px-10 pb-8 flex items-center justify-center">
            <p className="text-slate-400 text-[14px]">상세 일정 데이터가 아직 없습니다</p>
          </div>
          <ItineraryPageFooter />
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
        <h1 {...E} className={`text-[#001f3f] text-2xl font-extrabold leading-tight tracking-tight flex-1 break-keep ${EC}`}>{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
    </header>
  );
}

function Page1Footer() {
  return (
    <footer className="w-full bg-[#f3f3f4] py-3 px-10 flex justify-between items-center mt-auto">
      <div className="flex items-baseline gap-2">
        <span className="text-[#005d90] font-bold text-xs uppercase">YEOSONAM TRAVEL</span>
        <span className="text-[9px] text-slate-400">WWW.YEOSONAM.CO.KR</span>
      </div>
      <span className="text-slate-400 text-[9px]">© 2024 YEOSONAM. ALL RIGHTS RESERVED.</span>
    </footer>
  );
}


function PriceTable({ priceList, tiers, excludedDates }: { priceList?: PriceListItem[]; tiers?: PriceTier[]; excludedDates?: string[] }) {
  // price_list 우선 → 없으면 tiers 폴백 → 둘 다 없으면 렌더링 안 함
  const usePriceList = priceList && priceList.length > 0;
  const useTiers = !usePriceList && tiers && tiers.length > 0;
  if (!usePriceList && !useTiers) return null;

  const TH = 'text-[11px] bg-[#001f3f] font-semibold text-white py-1.5 px-2';

  // ── price_list 모드: 원본 PDF 구조 그대로 (기간 × 조건 그룹핑) ──
  if (usePriceList) {
    // 전체 최저가 식별
    const allPrices = priceList.flatMap(g => g.rules.map(r => r.price).filter((p): p is number => p !== null && p > 0));
    const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;

    // 조건(condition)명 수집 — 모든 그룹에서 동일 조건 컬럼 사용
    const conditionSet = new Set<string>();
    for (const g of priceList) for (const r of g.rules) conditionSet.add(r.condition);
    const conditions = Array.from(conditionSet);
    // 단일 조건이면 조건 열 없이 단순 테이블
    const multiCondition = conditions.length > 1;

    return (
      <section className="mb-3">
        <h3 {...E} className={`font-bold text-[#001f3f] mb-1.5 text-[13px] ${EC}`}>출발일별 요금</h3>
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
            {priceList.map((group, gIdx) => {
              const ruleCount = group.rules.length;
              return group.rules.map((rule, rIdx) => {
                const isMin = minPrice !== null && rule.price === minPrice;
                const bgClass = gIdx % 2 === 1 ? 'bg-slate-50' : '';
                return (
                  <tr key={`${gIdx}-${rIdx}`} className={bgClass}>
                    {rIdx === 0 && (
                      <td
                        rowSpan={ruleCount}
                        className="text-[11px] py-1 px-2 border-b border-slate-200 whitespace-nowrap font-semibold text-slate-800 align-middle"
                      >
                        {group.period}
                      </td>
                    )}
                    {multiCondition && (
                      <td className="text-[11px] py-1 px-2 border-b border-slate-100 text-center whitespace-nowrap text-slate-600">
                        {rule.condition}
                      </td>
                    )}
                    <td {...E} className={`text-[11px] py-1 px-2 border-b border-slate-100 text-right whitespace-nowrap tabular-nums ${isMin ? 'text-red-600 font-bold' : 'font-medium'} ${EC}`}>
                      {rule.price ? `₩${rule.price.toLocaleString()}` : rule.price_text || '-'}
                    </td>
                    <td className="text-[11px] py-1 px-2 border-b border-slate-100 text-center whitespace-nowrap">
                      {isMin ? <span className="text-red-600 font-bold text-xs">🔥최저가</span>
                        : rule.badge ? <span className="text-[10px] text-slate-500">{rule.badge}</span>
                        : null}
                    </td>
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
        {/* 부가 조건 (notes) 표 하단 표시 */}
        {priceList.some(g => g.notes) && (
          <div className="mt-1 space-y-0.5">
            {priceList.filter(g => g.notes).map((g, i) => (
              <p key={i} className="text-[10px] text-slate-500 leading-snug">• {g.notes}</p>
            ))}
          </div>
        )}
        {excludedDates && excludedDates.length > 0 && (
          <p className="mt-1 text-[10px] text-red-500 leading-snug">• 항공제외일: {excludedDates.join(', ')}</p>
        )}
      </section>
    );
  }

  // ── tiers 폴백 모드: 기간별 → 같은 가격 요일 병합 ──
  interface TierRow { days: string[]; adult_price: number; child_price?: number; }
  // Step 1: 기간별로 묶기
  const periodMap = new Map<string, { dow: string; adult: number; child?: number; note?: string }[]>();
  for (const tier of tiers!) {
    const period = tier.period_label.replace(/^\d{4}-\d{2}\s*/, '').trim() || tier.period_label;
    if (!periodMap.has(period)) periodMap.set(period, []);
    periodMap.get(period)!.push({
      dow: tier.departure_day_of_week || '',
      adult: tier.adult_price ?? 0,
      child: tier.child_price,
      note: tier.note || undefined,
    });
  }
  // Step 2: 각 기간 내에서 같은 가격끼리 요일 병합
  const periodNotes = new Map<string, string>();
  const groups: { period: string; rows: TierRow[] }[] = [];
  for (const [period, entries] of periodMap) {
    const firstNote = entries.find(e => e.note)?.note;
    if (firstNote) periodNotes.set(period, firstNote);
    const priceMap = new Map<string, { days: Set<string>; adult: number; child?: number }>();
    for (const e of entries) {
      const key = `${e.adult}_${e.child ?? 0}`;
      if (!priceMap.has(key)) priceMap.set(key, { days: new Set(), adult: e.adult, child: e.child });
      if (e.dow) priceMap.get(key)!.days.add(e.dow);
    }
    const rows: TierRow[] = Array.from(priceMap.values())
      .map(v => ({ days: Array.from(v.days), adult_price: v.adult, child_price: v.child }))
      .sort((a, b) => b.adult_price - a.adult_price);
    groups.push({ period, rows });
  }
  // Step 3: 가격 구조가 동일한 인접 기간 병합 (5/1~6/30 + 9/1~9/25 → "5/1~6/30\n9/1~9/25")
  const mergedGroups: typeof groups = [];
  for (const g of groups) {
    const priceKey = g.rows.map(r => `${r.adult_price}_${r.days.sort().join('')}`).join('|');
    const prev = mergedGroups[mergedGroups.length - 1];
    if (prev) {
      const prevKey = prev.rows.map(r => `${r.adult_price}_${r.days.sort().join('')}`).join('|');
      if (priceKey === prevKey) {
        prev.period += `\n${g.period}`;
        continue;
      }
    }
    mergedGroups.push({ ...g });
  }
  const hasChild = mergedGroups.some(g => g.rows.some(r => r.child_price && r.child_price > 0));
  const hasDow = mergedGroups.some(g => g.rows.some(r => r.days.length > 0));
  const allPrices = mergedGroups.flatMap(g => g.rows.map(r => r.adult_price)).filter(p => p > 0);
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;

  return (
    <section className="mb-3">
      <h3 {...E} className={`font-bold text-[#001f3f] mb-1.5 text-[13px] ${EC}`}>출발일별 요금</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th className={`${TH} text-left`}>출발 기간</th>
            {hasDow && <th className={`${TH} text-center`}>요일</th>}
            <th className={`${TH} text-right`}>성인</th>
            {hasChild && <th className={`${TH} text-right`}>아동</th>}
            <th className={`${TH} text-center`} style={{ width: '55px' }}>비고</th>
          </tr>
        </thead>
        <tbody>
          {mergedGroups.map((group, gIdx) =>
            group.rows.map((row, rIdx) => {
              const isMin = minPrice !== null && row.adult_price === minPrice;
              const bgClass = gIdx % 2 === 1 ? 'bg-slate-50' : '';
              return (
                <tr key={`${gIdx}-${rIdx}`} className={bgClass}>
                  {rIdx === 0 && (
                    <td rowSpan={group.rows.length} className="text-[11px] py-1 px-2 border-b border-slate-200 font-semibold text-slate-800 align-middle">
                      {group.period.split('\n').map((p, i) => <span key={i} className="block whitespace-nowrap">{p}</span>)}
                    </td>
                  )}
                  {hasDow && (
                    <td className="text-[11px] py-1 px-2 border-b border-slate-100 text-center whitespace-nowrap text-slate-600">
                      {row.days.length > 0 ? row.days.join(',') : '-'}
                    </td>
                  )}
                  <td {...E} className={`text-[11px] py-1 px-2 border-b border-slate-100 text-right whitespace-nowrap tabular-nums ${isMin ? 'text-red-600 font-bold' : 'font-medium'} ${EC}`}>
                    {row.adult_price ? `₩${row.adult_price.toLocaleString()}` : '-'}
                  </td>
                  {hasChild && (
                    <td {...E} className={`text-[11px] py-1 px-2 border-b border-slate-100 text-right whitespace-nowrap tabular-nums ${EC}`}>
                      {row.child_price ? `₩${row.child_price.toLocaleString()}` : '-'}
                    </td>
                  )}
                  <td className="text-[11px] py-1 px-2 border-b border-slate-100 text-center whitespace-nowrap">
                    {isMin && <span className="text-red-600 font-bold text-xs">🔥최저가</span>}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {/* 비고 note 중복 제거 후 하단 표시 */}
      {periodNotes.size > 0 && (
        <div className="mt-1 space-y-0.5">
          {[...new Set(periodNotes.values())].map((note, i) => (
            <p key={i} className="text-[10px] text-blue-600 leading-snug">• {note}</p>
          ))}
        </div>
      )}
      {excludedDates && excludedDates.length > 0 && (
        <p className="mt-1 text-[10px] text-red-500 leading-snug">• 항공제외일: {excludedDates.join(', ')}</p>
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

/**
 * Gemini 출력 후처리 — 항상 정확히 4건 × 최대 4불렛으로 정규화
 * Gemini가 11건을 반환하든 3건을 반환하든 결과는 동일한 포맷
 */
function normalizeNotices(raw: NoticeItemLocal[]): NoticeItemLocal[] {
  // Step 1: 같은 type끼리 병합
  const merged = new Map<NoticeItemLocal['type'], { titles: string[]; bullets: string[] }>();
  for (const t of VALID_TYPES) merged.set(t, { titles: [], bullets: [] });

  for (const notice of raw) {
    const type = VALID_TYPES.includes(notice.type) ? notice.type : 'INFO';
    const group = merged.get(type)!;
    if (notice.title && !group.titles.includes(notice.title)) group.titles.push(notice.title);
    // text를 불렛 단위로 분해
    const lines = notice.text.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const clean = line.startsWith('•') ? line : `• ${line}`;
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
      title: group.titles[0] || (type === 'CRITICAL' ? '필수 확인 사항' : type === 'PAYMENT' ? '추가 요금 안내' : type === 'POLICY' ? '이용 규정' : '현지 안내'),
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

// 포함/불포함만 표시 (Page 1 전용)
function IncludeExcludeInfo({ inclusions, excludes }: {
  inclusions?: string[]; excludes?: string[];
}) {
  if (!inclusions?.length && !excludes?.length) return null;
  return (
    <div className="grid grid-cols-2 gap-x-4 mb-1">
      {inclusions && inclusions.length > 0 && (
        <section className="bg-blue-50/60 p-2 rounded">
          <h3 className="font-bold text-blue-900 mb-1 text-[11px]">포함 사항</h3>
          <ul className="space-y-0 text-[11px] text-slate-700 leading-snug">
            {inclusions.map((item, idx) => <li key={idx} {...E} className={`flex gap-1 items-start break-keep ${EC}`}><span className="shrink-0 text-[10px]">✅</span> {item}</li>)}
          </ul>
        </section>
      )}
      {excludes && excludes.length > 0 && (
        <section className="bg-red-50/60 p-2 rounded">
          <h3 className="font-bold text-red-900 mb-1 text-[11px]">불포함 사항</h3>
          <ul className="space-y-0 text-[11px] text-slate-700 leading-snug">
            {excludes.map((item, idx) => <li key={idx} {...E} className={`flex gap-1 items-start break-keep ${EC}`}><span className="shrink-0 text-[10px]">❌</span> {item}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

// 유의사항 전용 페이지 (Page 1.5)
function NoticesPage({ noticesParsed, specialNotes }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  noticesParsed?: any[]; specialNotes?: string;
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
  } else if (specialNotes) {
    legacyNotes = splitSpecialNotes(specialNotes);
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
              const lines = notice.text.split('\n').map(l => l.trim()).filter(Boolean);
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

function OptionalTours({ tours }: { tours: { name: string; price_usd?: number }[] }) {
  return (
    <section className="mb-2">
      <h3 className="font-bold text-[#001f3f] mb-1 text-[11px]">선택 관광</h3>
      <div className="flex flex-wrap gap-1.5">
        {tours.map((tour, idx) => (
          <span key={idx} {...E} className={`px-1.5 py-0.5 bg-amber-50 text-amber-800 text-[10px] rounded border border-amber-200 font-medium ${EC}`}>
            {tour.name}{tour.price_usd ? ` ($${tour.price_usd})` : ''}
          </span>
        ))}
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════════════════
//  Page 2+ 서브 컴포넌트 (Stitch v2 일정표)
// ══════════════════════════════════════════════════════════

function ItineraryPageHeader({ title, departureAirport, destination }: { title: string; departureAirport?: string; destination?: string }) {
  return (
    <header className="w-full border-b-2 border-[#005d90] flex justify-between items-center px-10 py-6">
      <div className="flex flex-col">
        <span className="text-2xl font-bold tracking-tight text-[#005d90]">여행 일정표</span>
        <span className="text-xs font-semibold tracking-widest text-[#8e4e14] uppercase mt-0.5">TRAVEL ITINERARY</span>
      </div>
      <div className="text-right">
        <h1 {...E} className={`text-lg font-bold text-[#005d90] ${EC}`}>{title}</h1>
        {departureAirport && destination && (
          <p className="text-[10px] text-slate-500 font-medium">
            항공 일정: {departureAirport} ↔ {destination}
          </p>
        )}
      </div>
    </header>
  );
}

function ItineraryPageFooter() {
  return (
    <footer className="w-full px-10 py-4 border-t border-slate-200 mt-auto flex justify-between items-center bg-white">
      <div className="flex items-baseline gap-2">
        <span className="font-bold text-[#005d90] text-xs">YEOSONAM TRAVEL</span>
        <span className="text-[9px] text-slate-400">WWW.YEOSONAM.CO.KR</span>
      </div>
      <span className="text-[9px] text-red-400">* 현지 사정에 따라 일정이 변경될 수 있습니다.</span>
    </footer>
  );
}

// IATA 항공사 코드 → 항공사명
const AIRLINE_MAP: Record<string, string> = {
  'BX': '에어부산', 'LJ': '진에어', 'OZ': '아시아나항공', 'KE': '대한항공',
  '7C': '제주항공', 'TW': '티웨이항공', 'VJ': '비엣젯항공', 'ZE': '이스타항공',
  'RS': '에어서울', 'QV': '라오항공', 'JL': '일본항공', 'NH': '전일본공수',
  'MU': '중국동방항공', 'CA': '중국국제항공', 'CZ': '중국남방항공',
};
function getAirlineName(flightCode?: string | null): string | null {
  if (!flightCode) return null;
  const code = flightCode.replace(/[0-9]/g, '').toUpperCase();
  return AIRLINE_MAP[code] || null;
}

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

/** 일정표 — v3: 타임라인 dot + 관광지 설명 매칭 + JPG 최적화 */
function DailyItinerary({ days, attractions }: { days: DaySchedule[]; attractions?: AttractionInfo[] }) {
  return (
    <section className="space-y-3">
      {days.map((day) => {
        const flightItem = day.schedule?.find(s => s.type === 'flight');
        return (
          <div key={day.day} className="flex gap-3">
            {/* 좌측: 일차 숫자 */}
            <div className="w-12 shrink-0 text-center pt-0.5">
              <span className="text-2xl font-extrabold text-[#005d90] block leading-none">
                {String(day.day).padStart(2, '0')}
              </span>
              <span className="text-[11px] font-bold text-[#8e4e14] tracking-tight">
                {day.day}일차
              </span>
            </div>

            {/* 우측: 카드 */}
            <div className="flex-1 bg-slate-50/80 rounded-xl p-3 border border-slate-200">
              {/* 헤더: 항공편 있으면 1줄 통합, 없으면 route만 */}
              <div className="mb-1.5 pb-1.5 border-b border-slate-200">
                {flightItem ? (() => {
                  const flights = day.schedule!.filter(s => s.type === 'flight');
                  const dep = flights.find(f => f.activity?.includes('출발'));
                  const arr = flights.find(f => f.activity?.includes('도착'));
                  const airlineName = getAirlineName(flightItem.transport);
                  const route = day.regions?.join(' → ') || '';
                  return (
                    <div className="bg-blue-600 text-white rounded px-2.5 py-1.5 flex items-center justify-between text-[12px] font-semibold">
                      <div className="flex items-center gap-1.5">
                        <span>✈️ {flightItem.transport}</span>
                        {airlineName && <span className="text-blue-200 text-[10px] font-normal">({airlineName})</span>}
                        <span className="text-blue-100 font-normal">{route}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span>{dep?.time || flightItem.time || ''}</span>
                        <span className="text-blue-300">→</span>
                        <span>{arr?.time || ''}</span>
                      </div>
                    </div>
                  );
                })() : (
                  <h3 {...E} className={`text-[13px] font-bold text-[#001f3f] flex items-center gap-1.5 break-keep ${EC}`}>
                    📍 {day.regions?.join(' → ') || `${day.day}일차 일정`}
                  </h3>
                )}
              </div>

              {/* 타임라인: 세로선 + 색상 dot */}
              {day.schedule && day.schedule.filter(s => s.type !== 'flight').length > 0 && (
                <div className="relative border-l-2 border-slate-200 ml-2 space-y-1.5 pb-0.5">
                  {day.schedule.filter(s => s.type !== 'flight').map((item, sIdx) => {
                    const attr = matchAttraction(item.activity, attractions);
                    return (
                      <div key={sIdx} className="relative pl-4">
                        {/* dot */}
                        <div className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ring-2 border-2 border-white ${getDotColor(item.type)}`} />
                        <div className="flex flex-col">
                          <span {...E} className={`text-[12px] font-bold text-slate-800 break-keep leading-snug ${EC}`}>
                            {item.time && <span className="text-blue-600 mr-1">{item.time}</span>}
                            {attr?.emoji && <span className="mr-0.5">{attr.emoji}</span>}
                            {item.activity}
                            {item.badge && (
                              <span className="ml-1 inline-flex items-center px-1 py-0.5 bg-emerald-50 text-emerald-700 text-[9px] font-bold rounded border border-emerald-200">
                                {item.badge}
                              </span>
                            )}
                          </span>
                          {attr?.short_desc && (
                            <span className="text-[10px] text-slate-500 ml-0.5 leading-snug">{attr.short_desc}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 하단: 숙박 + 식사 */}
              <div className="mt-2 bg-white rounded-lg border border-slate-200 p-2">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
                  🏨 <span {...E} className={EC}>
                    {day.hotel ? `${day.hotel.name}${day.hotel.grade ? ` (${day.hotel.grade})` : ''}${day.hotel.note ? ` ${day.hotel.note}` : ''}` : '일정 종료'}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-600 mt-1 pt-1 border-t border-slate-100">
                  <span {...E} className={EC}>☕ 조: {day.meals?.breakfast_note || (day.meals?.breakfast ? '호텔식' : '불포함')}</span>
                  <span className="text-slate-300">|</span>
                  <span {...E} className={EC}>🍜 중: {day.meals?.lunch_note || (day.meals?.lunch ? '현지식' : '불포함')}</span>
                  <span className="text-slate-300">|</span>
                  <span {...E} className={EC}>🍽️ 석: {day.meals?.dinner_note || (day.meals?.dinner ? '현지식' : '불포함')}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
