import type { TravelItinerary, DaySchedule } from '@/types/itinerary';

// ── PriceTier 타입 (print/page.tsx에서 이동) ─────────────────────────────────
export interface PriceTier {
  departure_day?: string;
  departure_dates?: string[] | null;
  departure_day_of_week?: string;
  period_label?: string;
  date_range?: { start: string; end: string } | null;
  adult_price: number;
  status: string;
  note?: string | null;
}

// ── Props ─────────────────────────────────────────────────────────────────────
export interface PriceSheetTemplateProps {
  itinerary: TravelItinerary;
  priceTiers: PriceTier[];
  highlightDate?: string | null;
  excludedDates?: string[];
  confirmedPrice?: number | null;
  mode?: 'summary' | 'detail';
  daysWithDates?: (DaySchedule & { resolvedDate: string | null })[];
}

// ── 요일 정렬 순서: 월~일 ─────────────────────────────────────────────────────
const DAY_ORDER = ['월', '화', '수', '목', '금', '토', '일'];

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function formatMonth(ym: string): string {
  const m = parseInt(ym.split('-')[1], 10);
  return `${m}월`;
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-bold">{part}</strong> : part
  );
}

// date_range 기반 피벗 테이블 구조 생성
function buildPivotTable(tiers: PriceTier[]) {
  const hasPivot = tiers.some(t => t.date_range?.start);
  if (!hasPivot) return null;

  const monthSet = new Set<string>();
  tiers.forEach(t => {
    if (t.date_range?.start) monthSet.add(t.date_range.start.slice(0, 7));
  });
  const months = [...monthSet].sort();

  const dayMap = new Map<string, Map<string, PriceTier>>();
  tiers.forEach(t => {
    const day = t.departure_day_of_week ?? t.departure_day ?? '';
    const month = t.date_range?.start?.slice(0, 7) ?? '';
    if (!day || !month) return;
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    dayMap.get(day)!.set(month, t);
  });

  // 요일을 월~일 순서로 정렬
  const sortedDays = DAY_ORDER.filter(d => dayMap.has(d));

  return { months, dayMap, sortedDays };
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function PriceSheetTemplate({
  itinerary,
  priceTiers,
  highlightDate,
  excludedDates = [],
  confirmedPrice,
  mode = 'detail',
  daysWithDates = [],
}: PriceSheetTemplateProps) {
  const { meta, highlights } = itinerary;
  const pivot = buildPivotTable(priceTiers);
  const highlightDay = highlightDate ? new Date(highlightDate).getDate().toString() : null;

  const monthRangeLabel = pivot
    ? pivot.months.length === 1
      ? `${formatMonth(pivot.months[0])} 출발 `
      : `${formatMonth(pivot.months[0])}~${formatMonth(pivot.months[pivot.months.length - 1])} 출발 `
    : '출발 ';

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* ── 헤더 ─────────────────────────────────────────────────────── */}
      <div className="mb-1">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="bg-blue-700 text-white text-xs font-bold px-3 py-1 rounded">여소남</div>
            <span className="text-gray-400 text-xs">가치있는 여행을 소개하는</span>
          </div>
          <span className="text-gray-400 text-xs">{meta.departure_airport} 출발</span>
        </div>
        <div className="border-b-2 border-blue-700 pb-2">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-black text-gray-900">{meta.title}</h1>
            {meta.product_type && (
              <span className="text-sm font-bold text-blue-700 border border-blue-700 px-2 py-0.5 rounded">
                {meta.product_type}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {[meta.airline, meta.flight_out && meta.flight_in && `${meta.flight_out}/${meta.flight_in}`, `최소 ${meta.min_participants}명`, meta.room_type]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {/* ── 발권 배너 ────────────────────────────────────────────────── */}
      {meta.ticketing_deadline && (
        <div className="bg-red-50 border border-red-300 rounded px-3 py-2 flex items-center justify-between gap-3">
          {meta.departure_days && (
            <span className="text-red-600 font-bold text-sm shrink-0">
              📢 {meta.departure_days}
            </span>
          )}
          <span className="text-red-700 text-sm font-semibold ml-auto">
            ● {meta.ticketing_deadline} 항공권 발권하는 조건 ♥전/일/출/확♥
          </span>
        </div>
      )}

      {/* ── 해시태그 ─────────────────────────────────────────────────── */}
      {meta.hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta.hashtags.map((tag, i) => (
            <span key={i} className="text-blue-600 text-xs font-medium bg-blue-50 px-2 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ── 판매가표 ─────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 mb-1.5 flex items-center gap-1">
          <span className="w-1 h-4 bg-blue-700 inline-block rounded-sm" />
          {monthRangeLabel}판매가표 ({meta.nights}박{meta.days}일)
        </h2>

        <table className="w-full border-collapse text-sm">
          {pivot ? (
            /* ── 피벗 모드: 행=요일(월~일 정렬), 열=월 ── */
            <>
              <thead>
                <tr className="bg-blue-700 text-white">
                  <th className="border border-blue-600 px-3 py-1.5 text-center w-14">출발요일</th>
                  {pivot.months.map(m => (
                    <th key={m} className="border border-blue-600 px-3 py-1.5 text-center">
                      {formatMonth(m)} 1인 판매가
                    </th>
                  ))}
                  <th className="border border-blue-600 px-3 py-1.5 text-center w-28">비고</th>
                </tr>
              </thead>
              <tbody>
                {pivot.sortedDays.map((day, i) => {
                  const monthPrices = pivot.dayMap.get(day)!;
                  const firstTier = [...monthPrices.values()][0];
                  return (
                    <tr key={day} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="border border-gray-300 px-3 py-1.5 text-center font-bold text-blue-700">
                        {day}
                      </td>
                      {pivot.months.map(m => {
                        const tier = monthPrices.get(m);
                        return (
                          <td key={m} className="border border-gray-300 px-3 py-1.5 text-right font-medium">
                            {tier?.adult_price != null ? `${tier.adult_price.toLocaleString()}원` : '—'}
                          </td>
                        );
                      })}
                      <td className="border border-gray-300 px-3 py-1.5 text-center text-xs text-red-600">
                        {firstTier?.note ?? ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </>
          ) : (
            /* ── 기존 모드: 행=tier (departure_dates 기반) ── */
            <>
              <thead>
                <tr className="bg-blue-700 text-white">
                  <th className="border border-blue-600 px-3 py-1.5 text-center w-14">요일</th>
                  <th className="border border-blue-600 px-3 py-1.5 text-center">출발일</th>
                  <th className="border border-blue-600 px-3 py-1.5 text-center">
                    {meta.product_type || '성인'} 1인 판매가
                  </th>
                  <th className="border border-blue-600 px-3 py-1.5 text-center w-20">비고</th>
                </tr>
              </thead>
              <tbody>
                {priceTiers.map((tier, i) => {
                  const dates = tier.departure_dates ?? [];
                  const isHighlighted = !!(highlightDay && dates.includes(highlightDay));
                  const dayLabel = tier.departure_day_of_week ?? tier.departure_day ?? '';
                  const dateLabel = tier.period_label ?? (dates.length > 0 ? `${dates.join(', ')}일` : '—');
                  return (
                    <tr key={i} className={isHighlighted ? 'bg-yellow-100 font-bold' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="border border-gray-300 px-3 py-1.5 text-center font-medium">{dayLabel}</td>
                      <td className="border border-gray-300 px-3 py-1.5 text-center">
                        {dateLabel}
                        {isHighlighted && <span className="ml-1 text-blue-700">◀</span>}
                      </td>
                      <td className="border border-gray-300 px-3 py-1.5 text-right font-medium">
                        {tier.adult_price.toLocaleString()}원
                      </td>
                      <td className="border border-gray-300 px-3 py-1.5 text-center text-xs text-red-600">
                        {tier.note ?? ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </>
          )}
        </table>

        {/* 항공 제외일 */}
        {excludedDates.length > 0 && (
          <div className="mt-1.5 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-xs text-gray-500 flex gap-1.5 flex-wrap items-center">
            <span className="font-semibold text-red-500 flex-shrink-0">✈ 항공 제외일</span>
            {excludedDates.map((d, i) => {
              const dt = new Date(d);
              const label = `${dt.getMonth() + 1}/${dt.getDate()}`;
              return (
                <span key={i} className="px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-600 rounded font-medium">
                  {label}
                </span>
              );
            })}
            <span className="text-gray-400 ml-1">— 해당 날짜는 출발 불가</span>
          </div>
        )}
      </div>

      {/* ── 포함 / 불포함+쇼핑 / 비고 ───────────────────────────────── */}
      <div className="flex flex-col gap-2 text-xs">
        {/* 포함 */}
        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2">
          <h3 className="text-sm font-bold text-green-700 mb-1">✅ 포함 사항</h3>
          <ul className="space-y-0.5 text-gray-700">
            {highlights.inclusions.map((item, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-gray-400 flex-shrink-0">•</span>
                <span>{renderBold(item)}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 불포함 + 쇼핑 */}
        <div className="bg-red-50 border border-red-100 rounded px-3 py-2">
          <h3 className="text-sm font-bold text-red-600 mb-1">❌ 불포함 사항</h3>
          <ul className="space-y-0.5 text-gray-700 mb-1">
            {highlights.excludes.map((item, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-gray-400 flex-shrink-0">•</span>
                <span>{renderBold(item)}</span>
              </li>
            ))}
          </ul>
          {highlights.shopping && (
            <p className="text-gray-600 italic mt-1">
              🛍️ 쇼핑: {renderBold(highlights.shopping)}
            </p>
          )}
        </div>

        {/* 비고/RMK */}
        {highlights.remarks.length > 0 && (
          <div className="border border-orange-200 rounded bg-orange-50 px-3 py-2">
            <h3 className="text-sm font-bold text-orange-700 mb-1">⚠️ 비고 및 필수 안내</h3>
            <ul className="space-y-0.5 text-gray-700">
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

      {/* ── 요약 모드: 일정 개요 ─────────────────────────────────────── */}
      {mode === 'summary' && daysWithDates.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1">
            <span className="w-1 h-4 bg-blue-700 inline-block rounded-sm" />
            일정 개요
          </h2>
          <div className="border border-gray-200 rounded overflow-hidden">
            {daysWithDates.map((day, i) => (
              <div key={i} className={`flex gap-3 px-3 py-1.5 text-xs ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                <span className="font-bold text-blue-700 w-12 flex-shrink-0">제{day.day}일</span>
                <span className="text-gray-500 w-20 flex-shrink-0">{day.regions.join(' → ')}</span>
                <span className="text-gray-700 flex-1 min-w-0 truncate">
                  {day.schedule
                    .filter(s => s.type === 'normal' || s.type === 'flight')
                    .slice(0, 2)
                    .map(s => s.activity)
                    .join(' / ')}
                </span>
                <span className="text-gray-500 flex-shrink-0 text-right">
                  {[day.meals.breakfast && '조', day.meals.lunch && '중', day.meals.dinner && '석']
                    .filter(Boolean).join('/')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 푸터 ─────────────────────────────────────────────────────── */}
      <div className="mt-auto pt-3 border-t border-gray-200 flex justify-between text-xs text-gray-400">
        <span>여소남 — 가치있는 여행을 소개합니다</span>
        <span>※ 상기 일정은 현지 사정에 의해 변경될 수 있습니다.</span>
      </div>
    </div>
  );
}
