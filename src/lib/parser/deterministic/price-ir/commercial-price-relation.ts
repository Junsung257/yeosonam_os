import type { MatrixPriceRow, PriceIROptions } from './types.ts';
import { extractSourceWonAmounts } from './source-money.ts';

type SalePriceRelation = {
  finalSalePrice: number;
  listPrice: number | null;
  minTravelers: number | null;
  maxTravelers: number | null;
  relation: 'final_sale' | 'standard_sale';
};

const ARROW_RE = /(?:→|⇒|➜|⟶|▶|->|=>)/u;
const SALE_CUE_RE = /(?:1\s*인|성인|대인|상품가|판매가|행사가|특가|요금|\d{1,3}\s*(?:명|인)\s*(?:이상|부터|기준))/u;
const EXCLUDED_PRICE_RE = /(?:커미션|컴\s*\d|commission|\bcomm?\b|수수료|싱글|유류|기사|가이드|경비|팁|매너|비자|써차지|서차지|입장료|마사지|옵션|선택|예약금|계약금|취소|환불|보험|아동|소아|어린이|\d\s*(?:USD|US\$|\$|불|달러)|차지|비용\s*발생|추가\s*(?:금|비용)|갈라\s*디너|노\s*쇼핑)/iu;
const NEGATIVE_DATE_RE = /(?:발권|예약금|계약금|입금|마감|취소|환불|작성|수정|유효기간)/u;

function moneyValues(value: string, allowBareSaleShorthand = false): number[] {
  const commercialValue = value.replace(/\([^)]*(?:추가\s*할인|할인\s*혜택)[^)]*\)/gu, ' ');
  return extractSourceWonAmounts(commercialValue, {
    allowBareSaleShorthand,
    minAmount: 30_000,
    maxAmount: 50_000_000,
  }).map(candidate => candidate.amount);
}

function partyScope(line: string): Pick<SalePriceRelation, 'minTravelers' | 'maxTravelers'> {
  const compact = line.normalize('NFKC').replace(/\s+/gu, ' ');
  const range = compact.match(/(\d{1,3})\s*(?:~|-|–|—)\s*(\d{1,3})\s*(?:명|인)/u);
  if (range) return { minTravelers: Number(range[1]), maxTravelers: Number(range[2]) };
  const minimum = compact.match(/(\d{1,3})\s*(?:명|인)\s*(?:이상|부터|기준)/u)
    ?? compact.match(/최소\s*(\d{1,3})\s*(?:명|인)/u);
  if (minimum) return { minTravelers: Number(minimum[1]), maxTravelers: null };
  const exact = compact.match(/(?:성인\s*)?(\d{1,3})\s*(명|인)\s*(?:기준)?/u);
  // `1인 1,000,000원` is the normal per-person selling-price label, not a
  // one-traveler group restriction.
  if (exact?.[1] === '1' && exact[2] === '인') return { minTravelers: null, maxTravelers: null };
  return exact
    ? { minTravelers: Number(exact[1]), maxTravelers: Number(exact[1]) }
    : { minTravelers: null, maxTravelers: null };
}

/** Selects a customer selling price without using arbitrary first/minimum. */
export function parseFinalSalePriceFromLine(line: string): SalePriceRelation | null {
  const normalized = line.normalize('NFKC')
    // `성인/아동 동일` is a scope statement for the same proven package
    // price, not a separate child-price row.
    .replace(/(?:성인\s*\/\s*아동|아동\s*\/\s*성인)\s*(?:요금\s*)?동일/gu, '성인 동일');
  if (EXCLUDED_PRICE_RE.test(normalized)) return null;
  const scope = partyScope(normalized);
  const arrow = normalized.match(ARROW_RE);
  if (!arrow && !SALE_CUE_RE.test(normalized)) return null;
  if (arrow?.index != null) {
    const left = moneyValues(normalized.slice(0, arrow.index), true);
    const right = moneyValues(normalized.slice(arrow.index + arrow[0].length), true);
    if (left.length !== 1 || right.length !== 1) return null;
    return {
      finalSalePrice: right[0]!,
      listPrice: left[0]!,
      ...scope,
      relation: 'final_sale',
    };
  }
  const values = moneyValues(normalized, true);
  if (values.length !== 1) return null;
  return {
    finalSalePrice: values[0]!,
    listPrice: null,
    ...scope,
    relation: 'standard_sale',
  };
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function datesFromLine(line: string, fallbackYear?: number): string[] {
  if (NEGATIVE_DATE_RE.test(line)) return [];
  const dates = new Set<string>();
  for (const match of line.matchAll(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/gu)) {
    const date = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) dates.add(date);
  }
  for (const match of line.matchAll(/\b(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/gu)) {
    const date = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) dates.add(date);
  }
  if (dates.size > 0 || !fallbackYear) return [...dates];

  const monthDays = [...line.matchAll(/(?:^|\D)(\d{1,2})\s*[./]\s*(\d{1,2})/gu)];
  for (let index = 0; index < monthDays.length; index += 1) {
    const match = monthDays[index]!;
    const month = Number(match[1]);
    const first = isoDate(fallbackYear, month, Number(match[2]));
    if (first) dates.add(first);
    const matchEnd = (match.index ?? 0) + match[0].length;
    const nextStart = monthDays[index + 1]?.index ?? line.length;
    const continuation = line.slice(matchEnd, nextStart)
      .match(/^\s*((?:[,，&]\s*\d{1,2})*)/u)?.[1] ?? '';
    for (const day of continuation.match(/\d{1,2}/gu) ?? []) {
      const date = isoDate(fallbackYear, month, Number(day));
      if (date) dates.add(date);
    }
  }
  return [...dates];
}

function priceRegion(rawText: string): string[] {
  const lines = rawText.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const itineraryIndex = lines.findIndex(line => /^(?:제\s*1\s*일|DAY\s*1|일\s*자)$/iu.test(line.replace(/\s+/gu, '')));
  return lines.slice(0, itineraryIndex > 0 ? itineraryIndex : Math.min(lines.length, 100));
}

export function extractCommercialPriceRelationRows(
  rawText: string,
  options: PriceIROptions = {},
): MatrixPriceRow[] {
  const lines = priceRegion(rawText);
  const candidates = lines.flatMap((line, index) => {
    const relation = parseFinalSalePriceFromLine(line);
    return relation ? [{ line, index, relation }] : [];
  });
  if (candidates.length === 0) return [];

  const rows: MatrixPriceRow[] = [];
  for (const candidate of candidates) {
    const nearby = lines.slice(Math.max(0, candidate.index - 7), Math.min(lines.length, candidate.index + 4));
    let dates = nearby.flatMap(line => datesFromLine(line, options.year));
    if (dates.length === 0 && candidates.length === 1) {
      dates = lines
        .filter(line => /(?:출발|행사|여행기간|\d{1,2}\s*[./]\s*\d{1,2})/u.test(line))
        .flatMap(line => datesFromLine(line, options.year));
    }
    for (const date of [...new Set(dates)].sort()) {
      rows.push({
        date,
        adult_price: candidate.relation.finalSalePrice,
        child_price: null,
        list_price: candidate.relation.listPrice,
        min_travelers: candidate.relation.minTravelers,
        max_travelers: candidate.relation.maxTravelers,
        price_relation: candidate.relation.relation,
        note: candidate.line,
        status: 'available',
      });
    }
  }

  const byKey = new Map<string, MatrixPriceRow>();
  for (const row of rows) {
    const key = [row.date, row.adult_price, row.min_travelers ?? '', row.max_travelers ?? ''].join('|');
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((left, right) => left.date.localeCompare(right.date) || left.adult_price - right.adult_price);
}
