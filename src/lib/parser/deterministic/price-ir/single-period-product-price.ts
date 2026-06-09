import type { MatrixPriceRow, PriceIROptions } from './types';

type TravelPeriod = {
  startDate: string;
  endDate: string | null;
};

function toIsoDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseMoney(value: string): number | null {
  const cleaned = value.replace(/[^\d]/g, '');
  const price = Number(cleaned);
  if (!Number.isInteger(price) || price < 10_000 || price > 50_000_000) return null;
  return price;
}

function findTravelPeriod(rawText: string, fallbackYear?: number): TravelPeriod | null {
  const patterns = [
    /(?:여행\s*기간|행사\s*날짜|행사일자|출발\s*일자|출발일|출발\s*일정)[^\n]{0,80}?(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:~|-|–|—|부터)\s*(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/i,
    /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:~|-|–|—|부터)\s*(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일[^\n]{0,20}(?:까지|출발|행사)/i,
  ];

  for (const pattern of patterns) {
    const match = rawText.match(pattern);
    if (!match) continue;
    const startYear = Number(match[1]);
    const startMonth = Number(match[2]);
    const startDay = Number(match[3]);
    const endYear = Number(match[4] ?? startYear);
    const endMonth = Number(match[5]);
    const endDay = Number(match[6]);
    const startDate = toIsoDate(startYear, startMonth, startDay);
    const endDate = toIsoDate(endYear, endMonth, endDay);
    if (startDate) return { startDate, endDate };
  }

  const compact = rawText.match(/(?:여행\s*기간|행사\s*날짜|행사일자|출발\s*일자|출발일|출발\s*일정)[^\n]{0,60}?(\d{1,2})[./](\d{1,2})(?:\s*(?:~|-|–|—)\s*(\d{1,2})[./](\d{1,2}))?/i);
  if (!compact) return null;
  const year = fallbackYear && fallbackYear >= 2000 ? fallbackYear : new Date().getFullYear();
  const startDate = toIsoDate(year, Number(compact[1]), Number(compact[2]));
  const endDate = compact[3] && compact[4]
    ? toIsoDate(year, Number(compact[3]), Number(compact[4]))
    : null;
  return startDate ? { startDate, endDate } : null;
}

function isProductPriceLine(line: string): boolean {
  const compact = line.replace(/\s+/g, '');
  if (!/(상품가|판매가|행사가|상품금액|성인\/아동|성인\s*요금|아동\s*동일)/.test(line)) return false;
  if (/(싱글|유류|기사|가이드|경비|팁|매너|비자|써차지|서차지|입장료|마사지|옵션|선택|불포함|취소|환불|보험)/.test(compact)) return false;
  return true;
}

function findProductPrice(rawText: string): number | null {
  const lines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 80)) {
    if (!isProductPriceLine(line)) continue;
    const matches = [...line.matchAll(/(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d{5,8})\s*(?:원|KRW)?/gi)];
    const prices = matches
      .map(match => parseMoney(match[1]))
      .filter((price): price is number => price != null);
    if (prices.length > 0) return Math.min(...prices);
  }

  return null;
}

export function extractSinglePeriodProductPriceRows(
  rawText: string,
  options: PriceIROptions = {},
): MatrixPriceRow[] {
  const period = findTravelPeriod(rawText, options.year);
  const price = findProductPrice(rawText);
  if (!period || !price) return [];

  return [{
    date: period.startDate,
    adult_price: price,
    child_price: null,
    note: period.endDate
      ? `single_period_product_price:${period.startDate}~${period.endDate}`
      : 'single_period_product_price',
    status: 'available',
  }];
}
