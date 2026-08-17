import type { MatrixPriceRow, PriceIROptions } from './types.ts';

function toIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseMoney(value: string | undefined): number | null {
  const price = Number(value?.replace(/[^\d]/g, '') ?? 0);
  if (!Number.isInteger(price) || price < 10_000 || price > 50_000_000) return null;
  return price;
}

function parseFullDateList(line: string, fallbackYear?: number): string[] {
  const dates: string[] = [];
  const seen = new Set<string>();
  const push = (date: string | null) => {
    if (!date || seen.has(date)) return;
    seen.add(date);
    dates.push(date);
  };

  for (const match of line.matchAll(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/g)) {
    push(toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  for (const match of line.matchAll(/\b(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\b/g)) {
    push(toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])));
  }

  if (dates.length > 0) return dates;
  if (!fallbackYear || fallbackYear < 2000) return [];

  for (const match of line.matchAll(/\b(\d{1,2})[./](\d{1,2})\b/g)) {
    push(toIsoDate(fallbackYear, Number(match[1]), Number(match[2])));
  }
  for (const match of line.matchAll(/\b(\d{1,2})[./](\d{1,2})((?:\s*,\s*\d{1,2})+)/g)) {
    const month = Number(match[1]);
    for (const day of match[3]!.match(/\d{1,2}/g) ?? []) {
      push(toIsoDate(fallbackYear, month, Number(day)));
    }
  }
  return dates;
}

function lineHasDepartureDateLabel(line: string): boolean {
  return /출발(?:일|일자|날짜|일정)|행사(?:일|일자|날짜)/.test(line.replace(/\s+/g, ''));
}

function lineHasPriceLabel(line: string): boolean {
  return /요금표|상품가|판매가|행사가|성인(?:요금|가격)?|대인(?:요금|가격)?/.test(line.replace(/\s+/g, ''));
}

function isExcludedPriceLine(line: string): boolean {
  return /(가이드|기사|팁|매너|비자|써차지|서차지|싱글|유류|옵션|선택|마사지|쇼핑|취소|환불|보험|불포함)/.test(line);
}

function inferredYear(rawText: string, fallbackYear?: number): number {
  if (fallbackYear && fallbackYear >= 2000) return fallbackYear;
  const explicit = rawText.match(/\b(20\d{2})\s*\uB144/u)?.[1];
  if (explicit) return Number(explicit);
  const short = rawText.match(/(?:^|[^\d])(2\d)\s*\uB144/u)?.[1];
  return short ? 2000 + Number(short) : new Date().getFullYear();
}

function extractSplitLabelPriceRows(lines: string[], rawText: string, options: PriceIROptions): MatrixPriceRow[] {
  const itineraryHeader = lines.findIndex(line => /^(?:\uC77C\uC790|\uB0A0\uC9DC|DAY)/u.test(line.replace(/\s+/g, '')));
  const headerLines = lines.slice(0, itineraryHeader > 0 ? itineraryHeader : Math.min(lines.length, 80));
  if (!headerLines.some(line => /^(?:\uAE30\uAC04|\uCD9C\uBC1C\uC77C(?:\uC790|\uC815)?)$/u.test(line.replace(/\s+/g, '')))) return [];
  if (!headerLines.some(lineHasPriceLabel)) return [];

  const candidatePrices = headerLines.flatMap((line, index) => {
    if (isExcludedPriceLine(line)) return [];
    const nearbyPriceLabel = headerLines.slice(Math.max(0, index - 4), Math.min(headerLines.length, index + 5))
      .some(lineHasPriceLabel);
    if (!nearbyPriceLabel && !/(?:1\s*\uC778|\uC131\uC778|\uB300\uC778)/u.test(line)) return [];
    return [...line.matchAll(/(?:\u20A9\s*)?(\d{1,3}(?:,\d{3})+|\d{5,8})\s*(?:\uC6D0|KRW)?/giu)]
      .map(match => parseMoney(match[1]))
      .filter((price): price is number => price != null);
  });
  const uniquePrices = [...new Set(candidatePrices)];
  if (uniquePrices.length !== 1) return [];

  const year = inferredYear(rawText, options.year);
  const dates = [...new Set(headerLines
    .filter(line => !/(?:\uBC1C\uAD8C|\uB9C8\uAC10|\uAE4C\uC9C0|\uC608\uC57D\uAE08|\uCDE8\uC18C|\uD658\uBD88)/u.test(line))
    .flatMap(line => parseFullDateList(line, year)))].sort();
  if (dates.length === 0 || dates.length > 60) return [];
  return dates.map(date => ({
    date,
    adult_price: uniquePrices[0]!,
    child_price: null,
    note: 'labeled_date_list_price',
    status: 'available',
  }));
}

function extractAdultChildPrices(lines: string[], fromIndex: number): {
  adult: number;
  child: number | null;
} | null {
  for (let i = fromIndex; i < Math.min(lines.length, fromIndex + 18); i++) {
    const line = lines[i];
    // Excluded fees remain non-sale even when the line says the same fee
    // applies to adults and children.
    if (isExcludedPriceLine(line)) continue;
    if (!lineHasPriceLabel(line) && !/성인/.test(line)) continue;

    const adult = parseMoney(
      line.match(/(?:성인|대인)\s*(?:요금|가격)?\s*[:：]?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,8})\s*원?/)?.[1]
        ?? line.match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,8})\s*원?\s*\/\s*(?:인|성인)/)?.[1]
        ?? line.match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,8})\s*원?/)?.[1],
    );
    if (!adult) continue;

    const child = parseMoney(
      line.match(/(?:아동|소아|어린이)\s*(?:요금|가격)?\s*[:：]?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{5,8})\s*원?/)?.[1],
    );
    return { adult, child };
  }
  return null;
}

export function extractLabeledDateListPriceRows(
  rawText: string,
  options: PriceIROptions = {},
): MatrixPriceRow[] {
  const lines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const rows: MatrixPriceRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    if (!lineHasDepartureDateLabel(lines[i])) continue;
    const dateSearchText = [lines[i], ...lines.slice(i + 1, Math.min(lines.length, i + 4))]
      .join(' ');
    const dates = parseFullDateList(dateSearchText, options.year);
    if (dates.length === 0 || dates.length > 60) continue;

    const prices = extractAdultChildPrices(lines, i);
    if (!prices) continue;

    for (const date of dates) {
      const key = `${date}|${prices.adult}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        date,
        adult_price: prices.adult,
        child_price: prices.child,
        note: 'labeled_date_list_price',
        status: 'available',
      });
    }
  }

  if (rows.length === 0) rows.push(...extractSplitLabelPriceRows(lines, rawText, options));

  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
}
