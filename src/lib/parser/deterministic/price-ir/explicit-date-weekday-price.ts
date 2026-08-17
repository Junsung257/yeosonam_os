import type { MatrixPriceRow, PriceIROptions } from './types.ts';
import { extractSourceWonAmounts } from './source-money.ts';

const DOW: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function exactDepartureDates(lines: string[], year: number): string[] {
  const dates = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(/(?:^|\D)(\d{1,2})\s*[./]\s*(\d{1,2})((?:\s*[,，]\s*\d{1,2})+)\s*(?:중\s*)?(?:출발\s*기준|출발|出)/gu)) {
      const month = Number(match[1]);
      const days = [match[2]!, ...(match[3]?.match(/\d{1,2}/gu) ?? [])];
      for (const day of days) {
        const date = isoDate(year, month, Number(day));
        if (date) dates.add(date);
      }
    }
  }
  return [...dates].sort();
}

type WeekdayPriceRule = {
  weekdays: number[];
  amount: number;
  line: string;
};

function sameLineDatePriceRows(lines: string[], year: number): MatrixPriceRow[] {
  const rows: MatrixPriceRow[] = [];
  const seen = new Set<string>();
  const forbidden = /(?:커미션|commission|\bcomm?\b|수수료|싱글|아동|소아|유류|현지비|옵션|선택관광|취소|환불|예약금|계약금|발권|마감)/iu;
  for (const line of lines) {
    if (forbidden.test(line)) continue;
    const date = line.match(/(?:^|\D)(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*(?:\(([일월화수목금토])(?:요일)?\)|([일월화수목금토])\s*요일)?/u);
    if (!date) continue;
    const hasExplicitWeekday = Boolean(date[3] || date[4]);
    if (!hasExplicitWeekday && !/(?:출발|상품가|판매가|여행경비|특가)/u.test(line)) continue;
    const amounts = extractSourceWonAmounts(line, {
      allowBareSaleShorthand: true,
      minAmount: 250_000,
      maxAmount: 8_000_000,
    }).map(candidate => candidate.amount);
    // An arrow/list-price line has a separate commercial resolver. A simple
    // date row is accepted only when exactly one selling amount is present.
    if (amounts.length !== 1) continue;
    const resolvedDate = isoDate(year, Number(date[1]), Number(date[2]));
    if (!resolvedDate) continue;
    const key = `${resolvedDate}|${amounts[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      date: resolvedDate,
      weekday: DOW[date[3] ?? date[4] ?? ''] ?? null,
      adult_price: amounts[0]!,
      child_price: null,
      list_price: null,
      min_travelers: null,
      max_travelers: null,
      price_relation: 'standard_sale',
      note: line.trim(),
      status: 'available',
    });
  }
  return rows.sort((left, right) => left.date.localeCompare(right.date) || left.adult_price - right.adult_price);
}

function pairedHeaderDateSaleRows(lines: string[], fallbackYear: number): MatrixPriceRow[] {
  const headerEnd = lines.findIndex((line, index) => (
    index > 0
    && /^(?:\uD3EC\s*\uD568|\uBD88\s*\uD3EC\s*\uD568|\uC81C?\s*1\s*\uC77C|DAY\s*1)/iu.test(line)
  ));
  const header = lines.slice(0, headerEnd > 0 ? headerEnd : Math.min(lines.length, 40));
  const nonDepartureSaleContext = /(?:\uC36C\s*\uCC28\s*\uC9C0|surcharge|\uD560\s*\uC99D|\uCD94\s*\uAC00|\uC2F1\s*\uAE00|\uC544\s*\uB3D9|\uC18C\s*\uC544|\uC635\s*\uC158|\uC120\s*\uD0DD|\uB9C8\s*\uAC10|\uBC1C\s*\uAD8C|\uC81C\s*\uC678|\uBD88\s*\uD3EC\s*\uD568)/iu;
  const departureCandidates = header.flatMap((line, index) => {
    if (nonDepartureSaleContext.test(line)) return [];
    const match = line.match(/(?:(20\d{2}|\d{2})\s*\uB144\s*)?(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C\s*(?:\(([\uC77C\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0])(?:\uC694\uC77C)?\)|([\uC77C\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0])\s*\uC694\uC77C)?[^\n]{0,20}\uCD9C\s*\uBC1C/iu);
    if (!match) return [];
    const sourceYear = match[1]
      ? (match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]))
      : fallbackYear;
    const date = isoDate(sourceYear, Number(match[2]), Number(match[3]));
    if (!date) return [];
    return [{ date, weekday: DOW[match[4] ?? match[5] ?? ''] ?? null, line, index }];
  });
  if (departureCandidates.length !== 1) return [];

  const saleLabelIndexes = header.flatMap((line, index) => (
    /(?:\uC0C1\s*\uD488\s*\uAC00|\uD310\s*\uB9E4\s*\uAC00|\uC5EC\s*\uD589\s*\uACBD\s*\uBE44|\uCD1D\s*\uC0C1\s*\uD488\s*\uAE08\s*\uC561)/u.test(line) ? [index] : []
  ));
  if (saleLabelIndexes.length !== 1) return [];
  const saleLabelIndex = saleLabelIndexes[0]!;
  const forbidden = /(?:\uCEE4\s*\uBBF8\s*\uC158|commission|\bcomm?\b|\uC218\s*\uC218\s*\uB8CC|\uC2F1\s*\uAE00|\uC544\s*\uB3D9|\uC18C\s*\uC544|\uC720\s*\uB958|\uD604\s*\uC9C0\s*\uBE44|\uC635\s*\uC158|\uC120\s*\uD0DD|\uACC4\s*\uC57D\s*\uAE08)/iu;
  const priceCandidates = header.flatMap((line, index) => {
    if (Math.abs(index - saleLabelIndex) > 2 || forbidden.test(line)) return [];
    const amounts = extractSourceWonAmounts(line, {
      allowBareSaleShorthand: true,
      minAmount: 250_000,
      maxAmount: 8_000_000,
    }).map(candidate => candidate.amount);
    return amounts.length === 1 ? [{ amount: amounts[0]!, line, index }] : [];
  });
  if (priceCandidates.length !== 1) return [];

  const departure = departureCandidates[0]!;
  const sale = priceCandidates[0]!;
  return [{
    date: departure.date,
    weekday: departure.weekday,
    adult_price: sale.amount,
    child_price: null,
    list_price: null,
    min_travelers: null,
    max_travelers: null,
    price_relation: 'standard_sale',
    note: `${departure.line.trim()} | ${sale.line.trim()}`,
    status: 'available',
  }];
}

function weekdayPriceRules(lines: string[]): WeekdayPriceRule[] {
  const rules: WeekdayPriceRule[] = [];
  for (const line of lines) {
    const match = line.match(/(?:^|\s)([일월화수목금토]{1,7})\s*(?:出|출발)\s*(?:[-–—:：]|\s)\s*(\d{1,3}(?:,\d{3})+)\s*원?/u);
    if (!match || /(?:커미션|commission|\bcomm?\b|수수료|싱글|아동|소아|유류|현지비|옵션|선택)/iu.test(line)) continue;
    const weekdays = [...new Set([...match[1]!].map(label => DOW[label]!).filter(value => value != null))].sort();
    const amount = Number(match[2]!.replace(/,/gu, ''));
    if (weekdays.length === 0 || !Number.isInteger(amount) || amount < 100_000 || amount > 50_000_000) continue;
    rules.push({ weekdays, amount, line: line.trim() });
  }
  return rules;
}

/**
 * Resolves the common supplier form:
 * `9/26,27,28,29,30 중 출발기준` + `수목금出 619,000원`.
 * Every explicit departure must match exactly one weekday rule; otherwise the
 * resolver returns no candidates and the normal fail-closed gate remains.
 */
export function extractExplicitDateWeekdayPriceRows(
  rawText: string,
  options: PriceIROptions = {},
): MatrixPriceRow[] {
  if (!options.year) return [];
  const allLines = rawText.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const itineraryIndex = allLines.findIndex(line => /^(?:제\s*1\s*일|DAY\s*1|1\s*일차)/iu.test(line.replace(/\s+/gu, '')));
  const lines = allLines.slice(0, itineraryIndex > 0 ? itineraryIndex : Math.min(allLines.length, 120));
  const sameLineRows = sameLineDatePriceRows(lines, options.year);
  if (sameLineRows.length > 0) return sameLineRows;
  const pairedHeaderRows = pairedHeaderDateSaleRows(lines, options.year);
  if (pairedHeaderRows.length > 0) return pairedHeaderRows;
  const dates = exactDepartureDates(lines, options.year);
  const rules = weekdayPriceRules(lines);
  if (dates.length === 0 || rules.length < 2) return [];

  const rows: MatrixPriceRow[] = [];
  for (const date of dates) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const matching = rules.filter(rule => rule.weekdays.includes(weekday));
    if (matching.length !== 1) return [];
    const rule = matching[0]!;
    rows.push({
      date,
      weekday,
      adult_price: rule.amount,
      child_price: null,
      list_price: null,
      min_travelers: null,
      max_travelers: null,
      price_relation: 'standard_sale',
      note: rule.line,
      status: 'available',
    });
  }
  return rows;
}
