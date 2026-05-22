/**
 * period_label → departure_dates (legacy tier·LLM 라벨-only 회복)
 * "4/1,2,9,22 3박", "5/1~7/14", "2/28~3/10 연휴제외" 등
 */
import type { PriceTier } from './parser';
import { expandDateRangeToArray, expandPriceTiersDateRanges } from './expand-date-range';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 출발 월이 이미 지났으면 다음 해로 추론 */
export function inferDefaultTravelYear(referenceMonth?: number): number {
  const now = new Date();
  const y = now.getFullYear();
  const ref = referenceMonth ?? now.getMonth() + 1;
  if (ref < now.getMonth() + 1) return y + 1;
  return y;
}

const UNPARSEABLE = /요금표\s*참조|별도\s*문의|문의/i;

export function parsePeriodLabelToDates(
  label: string,
  opts: { year?: number; departureDayOfWeek?: string | null } = {},
): string[] {
  const text = (label ?? '').trim();
  if (!text || UNPARSEABLE.test(text)) return [];

  const year = opts.year ?? inferDefaultTravelYear();

  // M/D~M/D (跨월)
  const cross = text.match(/(\d{1,2})\/(\d{1,2})\s*[~\-–]\s*(\d{1,2})\/(\d{1,2})/);
  if (cross) {
    const m1 = Number(cross[1]);
    const d1 = Number(cross[2]);
    const m2 = Number(cross[3]);
    const d2 = Number(cross[4]);
    let endYear = year;
    if (m2 < m1) endYear = year + 1;
    return expandDateRangeToArray({
      dateRange: { start: toIso(year, m1, d1), end: toIso(endYear, m2, d2) },
      departureDayOfWeek: opts.departureDayOfWeek ?? undefined,
      periodLabel: text,
    });
  }

  // M/D~D (同月)
  const sameMonth = text.match(/(\d{1,2})\/(\d{1,2})\s*[~\-–]\s*(\d{1,2})(?!\s*\/)/);
  if (sameMonth) {
    const m = Number(sameMonth[1]);
    const dStart = Number(sameMonth[2]);
    const dEnd = Number(sameMonth[3]);
    const y = opts.year ?? (m < new Date().getMonth() + 1 ? year + 1 : year);
    return expandDateRangeToArray({
      dateRange: { start: toIso(y, m, dStart), end: toIso(y, m, dEnd) },
      departureDayOfWeek: opts.departureDayOfWeek ?? undefined,
      periodLabel: text,
    });
  }

  // M/D,D,D…
  const list = text.match(/(\d{1,2})\/([\d,]+)/);
  if (list) {
    const month = Number(list[1]);
    const y = opts.year ?? (month < new Date().getMonth() + 1 ? year + 1 : year);
    const days = list[2]
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => n > 0 && n <= 31);
    return days.map(d => toIso(y, month, d));
  }

  return [];
}

/** 제목·라벨에서 여행 연도 추출 (<<2026>>, 2026년) */
export function inferTravelYearFromText(...texts: (string | null | undefined)[]): number | undefined {
  for (const t of texts) {
    if (!t) continue;
    const m = t.match(/(?:<<|【|\[)?\s*(20\d{2})\s*(?:년|>>|】|\])?/);
    if (m) return Number(m[1]);
  }
  return undefined;
}

export function hydratePriceTiers(
  tiers: PriceTier[],
  ctx: { year?: number; packageDepartureDays?: string } = {},
): PriceTier[] {
  const expanded = expandPriceTiersDateRanges(tiers, ctx.packageDepartureDays);
  return expanded.map(tier => {
    if (tier.departure_dates?.length) return tier;
    const fromLabel = parsePeriodLabelToDates(tier.period_label ?? '', {
      year: ctx.year,
      departureDayOfWeek: tier.departure_day_of_week ?? ctx.packageDepartureDays ?? null,
    });
    if (fromLabel.length === 0) return tier;
    return { ...tier, departure_dates: [...fromLabel].sort() };
  });
}
