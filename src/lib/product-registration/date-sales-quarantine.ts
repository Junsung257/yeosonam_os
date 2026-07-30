import type { PriceTier } from '@/lib/parser';
import type { PriceDate } from '@/lib/price-dates';
import type { ProductPriceRowInput } from '@/lib/upload-validator';

const HOLIDAY_RE = /(?:일본\s*(?:공휴일|휴일|연휴)|일본연휴기간|오봉|골든\s*위크)/iu;
const GROUND_COST_SURCHARGE_RE = /지상비\s*(?:가\s*)?(?:추가|인상|할증)/u;
const EXPLICIT_MONEY_RE =
  /(?:\d[\d,]*(?:\.\d+)?\s*(?:만\s*)?(?:원|엔|달러|USD|JPY|KRW)|[$¥￥]\s*\d)/iu;
const DATE_TOKEN_RE =
  /(?:(\d{1,2})\s*\/\s*)?(\d{1,2})(?:\s*[~\-–—]\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2}))?/gu;
const SOURCE_EXCLUSION_RE = /(?:항공\s*제외일|비운항|출발\s*불가|판매\s*불가)/u;

export type DateSalesQuarantine = {
  reason: 'unpriced_holiday_ground_cost';
  safeState: 'date_sales_quarantined';
  sourceText: string;
  lineNumber: number;
  dateTokens: string[];
  dates: string[];
};

export type DateSalesQuarantineApplication = {
  quarantines: DateSalesQuarantine[];
  quarantinedDates: string[];
  removedPriceDates: string[];
  removedPriceRows: string[];
  ok: boolean;
  failure: string | null;
  tiers: PriceTier[];
  priceRows: ProductPriceRowInput[];
  priceDates: PriceDate[];
  minPrice: number | null;
};

export type SourceDeclaredSalesExclusion = {
  reason: 'source_declared_sales_exclusion';
  sourceText: string;
  lineNumber: number;
  dateTokens: string[];
  dates: string[];
};

export type SourceDeclaredSalesExclusionApplication = {
  exclusions: SourceDeclaredSalesExclusion[];
  excludedDates: string[];
  removedPriceDates: string[];
  removedPriceRows: string[];
  ok: boolean;
  failure: string | null;
  tiers: PriceTier[];
  priceRows: ProductPriceRowInput[];
  priceDates: PriceDate[];
  minPrice: number | null;
};

function isValidYear(year: number | null | undefined): year is number {
  return typeof year === 'number'
    && Number.isInteger(year)
    && year >= 2000
    && year <= 2100;
}

function isoDate(year: number, month: number, day: number): string | null {
  const value = new Date(year, month - 1, day);
  if (
    value.getFullYear() !== year
    || value.getMonth() !== month - 1
    || value.getDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function expandDateSpan(input: {
  year: number;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
}): string[] {
  const start = new Date(input.year, input.startMonth - 1, input.startDay);
  const endYear = input.endMonth < input.startMonth ? input.year + 1 : input.year;
  const end = new Date(endYear, input.endMonth - 1, input.endDay);
  if (
    isoDate(input.year, input.startMonth, input.startDay) == null
    || isoDate(endYear, input.endMonth, input.endDay) == null
    || start > end
  ) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && dates.length <= 120) {
    const iso = isoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    if (iso) dates.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates.length <= 120 ? dates : [];
}

function parseDateSpans(sourceText: string, year: number): {
  dateTokens: string[];
  dates: string[];
} {
  const dateTokens: string[] = [];
  const dates = new Set<string>();
  let currentMonth: number | null = null;

  for (const match of sourceText.matchAll(DATE_TOKEN_RE)) {
    if (match[1]) currentMonth = Number(match[1]);
    if (currentMonth == null) continue;
    const startMonth = currentMonth;
    const startDay = Number(match[2]);
    const endMonth = match[4] ? Number(match[3] ?? startMonth) : startMonth;
    const endDay = match[4] ? Number(match[4]) : startDay;
    const expanded = expandDateSpan({
      year,
      startMonth,
      startDay,
      endMonth,
      endDay,
    });
    if (expanded.length === 0) continue;
    const token = startMonth === endMonth && startDay === endDay
      ? `${startMonth}/${startDay}`
      : `${startMonth}/${startDay}~${endMonth}/${endDay}`;
    dateTokens.push(token);
    for (const date of expanded) dates.add(date);
  }

  return {
    dateTokens: [...new Set(dateTokens)],
    dates: [...dates].sort(),
  };
}

export function extractSourceDeclaredSalesExclusions(
  rawText: string | null | undefined,
  year: number | null | undefined,
): SourceDeclaredSalesExclusion[] {
  if (!rawText || !isValidYear(year)) return [];

  const exclusions: SourceDeclaredSalesExclusion[] = [];
  const seen = new Set<string>();
  const lines = rawText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const sourceText = lines[index].replace(/\s+/g, ' ').trim();
    if (!sourceText || !SOURCE_EXCLUSION_RE.test(sourceText)) continue;
    const parsed = parseDateSpans(sourceText, year);
    if (parsed.dates.length === 0 || seen.has(sourceText)) continue;
    seen.add(sourceText);
    exclusions.push({
      reason: 'source_declared_sales_exclusion',
      sourceText,
      lineNumber: index + 1,
      dateTokens: parsed.dateTokens,
      dates: parsed.dates,
    });
  }
  return exclusions;
}

export function extractUnpricedDateSalesQuarantines(
  rawText: string | null | undefined,
  year: number | null | undefined,
): DateSalesQuarantine[] {
  if (!rawText || !isValidYear(year)) return [];

  const quarantines: DateSalesQuarantine[] = [];
  const seen = new Set<string>();
  const lines = rawText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const sourceText = lines[index].replace(/\s+/g, ' ').trim();
    if (
      !sourceText
      || !HOLIDAY_RE.test(sourceText)
      || !GROUND_COST_SURCHARGE_RE.test(sourceText)
      || EXPLICIT_MONEY_RE.test(sourceText)
    ) continue;

    const parsed = parseDateSpans(sourceText, year);
    if (parsed.dates.length === 0) continue;
    const key = sourceText;
    if (seen.has(key)) continue;
    seen.add(key);
    quarantines.push({
      reason: 'unpriced_holiday_ground_cost',
      safeState: 'date_sales_quarantined',
      sourceText,
      lineNumber: index + 1,
      dateTokens: parsed.dateTokens,
      dates: parsed.dates,
    });
  }
  return quarantines;
}

function sellingPrice(row: ProductPriceRowInput): number {
  return row.adult_selling_price ?? row.net_price;
}

function applyExcludedDateSet(input: {
  excludedDates: string[];
  tiers: PriceTier[];
  priceRows: ProductPriceRowInput[];
  priceDates: PriceDate[];
}): Omit<SourceDeclaredSalesExclusionApplication, 'exclusions' | 'excludedDates'> {
  const exclusionSet = new Set(input.excludedDates);
  const undatedRows = input.priceRows.filter(row => row.target_date == null);
  if (undatedRows.length > 0) {
    return {
      removedPriceDates: [],
      removedPriceRows: [],
      ok: false,
      failure: 'date sales restriction cannot prove exclusion for undated weekday price rows',
      tiers: input.tiers,
      priceRows: input.priceRows,
      priceDates: input.priceDates,
      minPrice: input.priceDates.length > 0
        ? Math.min(...input.priceDates.map(row => row.price))
        : null,
    };
  }

  const removedPriceDates = input.priceDates
    .filter(row => exclusionSet.has(row.date))
    .map(row => row.date);
  const removedPriceRows = input.priceRows
    .filter(row => row.target_date != null && exclusionSet.has(row.target_date))
    .map(row => row.target_date as string);
  const priceDates = input.priceDates.filter(row => !exclusionSet.has(row.date));
  const priceRows = input.priceRows.filter(row => (
    row.target_date == null || !exclusionSet.has(row.target_date)
  ));
  const tiers = input.tiers
    .map(tier => {
      const existingExcluded = Array.isArray(tier.excluded_dates) ? tier.excluded_dates : [];
      return {
        ...tier,
        departure_dates: (tier.departure_dates ?? []).filter(date => !exclusionSet.has(date)),
        excluded_dates: [...new Set([...existingExcluded, ...input.excludedDates])].sort(),
      };
    })
    .filter(tier => (
      tier.departure_dates.length > 0
      || Boolean(tier.date_range?.start && tier.date_range?.end && tier.departure_day_of_week)
    ));

  if (priceDates.length === 0 || priceRows.length === 0) {
    return {
      removedPriceDates,
      removedPriceRows,
      ok: false,
      failure: 'date sales restriction removed every customer-sale departure date',
      tiers,
      priceRows,
      priceDates,
      minPrice: null,
    };
  }

  return {
    removedPriceDates,
    removedPriceRows,
    ok: true,
    failure: null,
    tiers,
    priceRows,
    priceDates,
    minPrice: Math.min(
      ...priceDates.map(row => row.price),
      ...priceRows.map(sellingPrice),
    ),
  };
}

export function applySourceDeclaredSalesExclusions(input: {
  rawText: string | null | undefined;
  year: number | null | undefined;
  tiers: PriceTier[];
  priceRows: ProductPriceRowInput[];
  priceDates: PriceDate[];
}): SourceDeclaredSalesExclusionApplication {
  const exclusions = extractSourceDeclaredSalesExclusions(input.rawText, input.year);
  const excludedDates = [...new Set(exclusions.flatMap(item => item.dates))].sort();
  if (exclusions.length === 0) {
    return {
      exclusions,
      excludedDates,
      removedPriceDates: [],
      removedPriceRows: [],
      ok: true,
      failure: null,
      tiers: input.tiers,
      priceRows: input.priceRows,
      priceDates: input.priceDates,
      minPrice: input.priceDates.length > 0
        ? Math.min(...input.priceDates.map(row => row.price))
        : null,
    };
  }
  return {
    exclusions,
    excludedDates,
    ...applyExcludedDateSet({
      excludedDates,
      tiers: input.tiers,
      priceRows: input.priceRows,
      priceDates: input.priceDates,
    }),
  };
}

export function applyUnpricedDateSalesQuarantine(input: {
  rawText: string | null | undefined;
  year: number | null | undefined;
  tiers: PriceTier[];
  priceRows: ProductPriceRowInput[];
  priceDates: PriceDate[];
}): DateSalesQuarantineApplication {
  const quarantines = extractUnpricedDateSalesQuarantines(input.rawText, input.year);
  const quarantinedDates = [...new Set(quarantines.flatMap(item => item.dates))].sort();
  if (quarantines.length === 0) {
    return {
      quarantines,
      quarantinedDates,
      removedPriceDates: [],
      removedPriceRows: [],
      ok: true,
      failure: null,
      tiers: input.tiers,
      priceRows: input.priceRows,
      priceDates: input.priceDates,
      minPrice: input.priceDates.length > 0
        ? Math.min(...input.priceDates.map(row => row.price))
        : null,
    };
  }

  const applied = applyExcludedDateSet({
    excludedDates: quarantinedDates,
    tiers: input.tiers,
    priceRows: input.priceRows,
    priceDates: input.priceDates,
  });
  return {
    quarantines,
    quarantinedDates,
    ...applied,
    failure: applied.failure?.replace('date sales restriction', 'date sales quarantine') ?? null,
  };
}
