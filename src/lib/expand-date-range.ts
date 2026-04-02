/**
 * date_range → departure_dates 자동 전개 유틸리티
 * 기간형 요금 tier를 요일 기반 개별 날짜 배열로 변환
 */
import type { PriceTier } from './parser';

const DAY_MAP: Record<string, number> = {
  '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6,
};

/**
 * 요일 문자열 → Date.getDay() 인덱스 배열
 * "일,월" | "일월" | "매주 목요일" | "목|금" → [0,1] | [4,5] 등
 */
function parseDayIndices(dayStr?: string, fallbackDays?: string): number[] {
  const src = (dayStr || fallbackDays || '');
  // "매일" = 모든 요일
  if (/매일/.test(src)) return [0, 1, 2, 3, 4, 5, 6];
  const cleaned = src.replace(/매주|요일/g, '');
  const indices: number[] = [];
  for (const [k, v] of Object.entries(DAY_MAP)) {
    if (cleaned.includes(k)) indices.push(v);
  }
  return indices;
}

/**
 * period_label에서 제외일 파싱: "(5/21,22 제외)" → Set<"5/21","5/22">
 */
function parseExcludedFromLabel(label: string): Set<string> {
  const s = new Set<string>();
  const m = label.match(/\(([^)]*제외)\)/);
  if (!m) return s;
  const parts = m[1].replace(/\s*제외/, '').split(',');
  let lastMonth = '';
  for (const p of parts) {
    const mp = p.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (mp) {
      lastMonth = mp[1];
      s.add(`${mp[1]}/${mp[2]}`);
    } else {
      const dp = p.trim().match(/^(\d{1,2})$/);
      if (dp && lastMonth) s.add(`${lastMonth}/${dp[1]}`);
    }
  }
  return s;
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * departure_dates 배열에서 정확한 departure_day_of_week 역산
 * ["2026-05-03","2026-05-04"] → "일,월"
 */
function deriveDayOfWeek(dates: string[]): string | undefined {
  const daySet = new Set<number>();
  for (const d of dates) {
    const dt = new Date(d);
    if (!isNaN(dt.getTime())) daySet.add(dt.getDay());
  }
  if (daySet.size === 0) return undefined;
  return [...daySet].sort((a, b) => a - b).map(i => DAY_NAMES[i]).join(',');
}

/**
 * 개별 tier의 date_range → departure_dates 전개
 */
export function expandDateRangeToArray(opts: {
  dateRange: { start: string; end: string };
  departureDayOfWeek?: string;
  departureDays?: string;
  periodLabel?: string;
}): string[] {
  if (!opts.dateRange?.start || !opts.dateRange?.end) return [];

  const start = new Date(opts.dateRange.start);
  const end = new Date(opts.dateRange.end);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  const dayIndices = parseDayIndices(opts.departureDayOfWeek, opts.departureDays);
  if (dayIndices.length === 0) return [];

  const excluded = opts.periodLabel ? parseExcludedFromLabel(opts.periodLabel) : new Set<string>();
  const dates: string[] = [];

  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    if (!dayIndices.includes(cur.getDay())) continue;
    const mm = cur.getMonth() + 1;
    const dd = cur.getDate();
    if (excluded.has(`${mm}/${dd}`)) continue;
    dates.push(formatDateKey(cur));
  }

  return dates;
}

/**
 * price_tiers 배열 일괄 처리: date_range → departure_dates 전개
 * - 이미 departure_dates가 있는 tier는 스킵
 * - date_range는 원본 참조용으로 유지
 */
export function expandPriceTiersDateRanges(
  tiers: PriceTier[],
  packageDepartureDays?: string,
): PriceTier[] {
  return tiers.map(tier => {
    let dates = tier.departure_dates;

    // date_range만 있고 departure_dates 없으면 전개
    if ((!dates || dates.length === 0) && tier.date_range) {
      dates = expandDateRangeToArray({
        dateRange: tier.date_range,
        departureDayOfWeek: tier.departure_day_of_week,
        departureDays: packageDepartureDays,
        periodLabel: tier.period_label,
      });
    }

    // departure_dates가 있으면 정확한 요일 역산
    if (dates && dates.length > 0) {
      const correctDow = deriveDayOfWeek(dates);
      return { ...tier, departure_dates: dates, departure_day_of_week: correctDow };
    }

    return tier;
  });
}

/**
 * 상품 출발요일과 불일치하는 tier 제거
 * 예: 상품이 "일,월"인데 tier가 "목,금"이면 제거
 */
export function filterTiersByDepartureDays(
  tiers: PriceTier[],
  departureDays?: string,
): PriceTier[] {
  if (!departureDays) return tiers;

  const pkgIndices = parseDayIndices(departureDays);
  if (pkgIndices.length === 0) return tiers;

  return tiers.filter(tier => {
    if (!tier.departure_day_of_week) return true;
    const tierIndices = parseDayIndices(tier.departure_day_of_week);
    if (tierIndices.length === 0) return true;
    return tierIndices.some(d => pkgIndices.includes(d));
  });
}
