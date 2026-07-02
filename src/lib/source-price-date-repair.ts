import { extractPriceIR } from '@/lib/parser/deterministic/price-ir';
import type { PriceDate } from '@/lib/price-dates';
import { inferDepartureDaysFromRawText } from '@/lib/product-registration/departure-days';
import { resolvePriceRecoveryYear } from '@/lib/product-registration/price-year';
import { formatKstDate, isUpcomingKstDate } from '@/lib/kst-date';

export type SourcePriceRepairPackage = {
  id?: string | null;
  title?: string | null;
  display_title?: string | null;
  hero_tagline?: string | null;
  trip_style?: string | null;
  duration?: number | null;
  raw_text?: string | null;
  itinerary_data?: unknown;
  accommodations?: string[] | null;
  referenceDate?: string | null;
  price_dates?: Array<{
    date?: string | null;
    price?: number | null;
    adult_price?: number | null;
    adult_selling_price?: number | null;
    selling_price?: number | null;
    child_price?: number | null;
    currency?: string | null;
    confirmed?: boolean | null;
  }> | null;
  departure_days?: unknown;
};

export type SourceBackedPriceDateRepair =
  | {
      status: 'not_needed' | 'unavailable' | 'unsafe';
      reason: string;
      source?: string;
      expectedCount?: number;
      existingCount?: number;
      addedCount?: number;
      excludedPriceCandidates?: ExcludedPriceCandidate[];
    }
  | {
      status: 'repaired';
      reason: string;
      source: string;
      expectedCount: number;
      existingCount: number;
      addedCount: number;
      priceDates: PriceDate[];
      excludedPriceCandidates?: ExcludedPriceCandidate[];
    };

type SourcePriceIRRow = {
  date: string;
  adult_price: number;
  child_price?: number | null;
  status?: string | null;
};

type DuplicatePricePreference = 'min' | 'max' | null;

export type ExcludedPriceCandidate = {
  date?: string | null;
  amount: number;
  currency: 'KRW' | 'USD' | 'JPY' | 'VND';
  reason:
    | 'optional_tour_candidate'
    | 'local_expense_candidate'
    | 'golf_option_candidate'
    | 'option_sized_price_candidate'
    | 'duplicate_variant_not_selected';
  sourceStatus?: string | null;
  quote?: string | null;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const OPTION_SIZED_PRICE_CEILING = 100_000;
const PACKAGE_PRICE_FLOOR = 300_000;

function classifyExcludedPriceReason(line: string): ExcludedPriceCandidate['reason'] {
  if (/(?:golf|green\s*fee|caddie|cart|tee\s*time|골프|그린피|캐디|카트)/i.test(line)) return 'golf_option_candidate';
  if (/(?:local|onsite|on-site|현지|불포함|가이드\s*팁|기사\s*팁)/i.test(line)) return 'local_expense_candidate';
  return 'optional_tour_candidate';
}

export function extractExcludedPriceCandidatesFromRawText(rawText: string): ExcludedPriceCandidate[] {
  const candidates: ExcludedPriceCandidate[] = [];
  const seen = new Set<string>();
  const currencyPatterns: Array<{ currency: ExcludedPriceCandidate['currency']; regex: RegExp; amountGroup: number }> = [
    { currency: 'USD', regex: /\b(?:USD|US\$)\s*([0-9]+(?:\.[0-9]+)?)/gi, amountGroup: 1 },
    { currency: 'USD', regex: /(^|[^\w])\$\s*([0-9]+(?:\.[0-9]+)?)/g, amountGroup: 2 },
    { currency: 'JPY', regex: /\bJPY\s*([0-9][0-9,]*)/gi, amountGroup: 1 },
    { currency: 'VND', regex: /\bVND\s*([0-9][0-9,]*)/gi, amountGroup: 1 },
  ];

  for (const line of rawText.split(/\r?\n/)) {
    if (!/(?:optional|tour|local|onsite|on-site|golf|green|caddie|cart|USD|US\$|\$|JPY|VND|선택|현지|골프|그린피|캐디|카트)/i.test(line)) continue;
    const reason = classifyExcludedPriceReason(line);
    for (const pattern of currencyPatterns) {
      pattern.regex.lastIndex = 0;
      for (const match of line.matchAll(pattern.regex)) {
        const rawAmount = match[pattern.amountGroup]?.replace(/,/g, '');
        const amount = Number(rawAmount);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const key = `${pattern.currency}:${amount}:${reason}:${line.trim()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          amount,
          currency: pattern.currency,
          reason,
          quote: line.trim().slice(0, 240),
        });
      }
    }
  }

  return candidates;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
}

function isUpcomingSourceDate(date: string, today: string = formatKstDate()): boolean {
  return isUpcomingKstDate(date, today);
}

function sourceRepairReferenceDate(pkg: SourcePriceRepairPackage): string {
  return isIsoDate(pkg.referenceDate) ? pkg.referenceDate : formatKstDate();
}

function priceValue(row: SourcePriceRepairPackage['price_dates'] extends Array<infer R> | null | undefined ? R : never): number | null {
  const value = row?.price ?? row?.adult_price ?? row?.adult_selling_price ?? row?.selling_price;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function sourceMonthDayDatesForYear(rawText: string, year: number): Date[] {
  const dates: Date[] = [];
  const seen = new Set<string>();
  const monthDayRe = /(^|[^\d])(\d{1,2})\s*\/\s*(\d{1,2})(?!\s*\/?\d)/g;
  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^\d{1,2}\s*\/\s*\d{1,2}/.test(trimmed)) continue;
    for (const match of trimmed.matchAll(monthDayRe)) {
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) continue;
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) continue;
      const key = date.toISOString().slice(0, 10);
      if (seen.has(key)) continue;
      seen.add(key);
      dates.push(date);
    }
  }
  return dates;
}

function shouldPreferFutureDbPriceYear(pkg: SourcePriceRepairPackage, rawText: string, sourceYear: number, dbYear: number): boolean {
  if (dbYear <= sourceYear) return false;

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const existingRows = (pkg.price_dates ?? [])
    .map(row => (typeof row.date === 'string' && ISO_DATE_RE.test(row.date) ? new Date(`${row.date}T00:00:00Z`) : null))
    .filter((date): date is Date => date instanceof Date && Number.isFinite(date.getTime()));
  const allExistingFuture = existingRows.length > 0 && existingRows.every(date => date.getTime() >= todayUtc);
  if (!allExistingFuture || sourceYear > now.getUTCFullYear()) return false;

  const sourceDates = sourceMonthDayDatesForYear(rawText, sourceYear);
  return sourceDates.length > 0 && sourceDates.every(date => date.getTime() < todayUtc);
}

function inferDurationDays(pkg: SourcePriceRepairPackage): number | null {
  if (typeof pkg.duration === 'number' && Number.isFinite(pkg.duration) && pkg.duration > 0) return pkg.duration;
  const titleMatch = pkg.title?.match(/(\d+)\s*박\s*(\d+)\s*일/);
  return titleMatch ? Number(titleMatch[2]) : null;
}

function selectedVariantText(pkg: SourcePriceRepairPackage): string {
  const parts = [
    pkg.title,
    pkg.display_title,
    pkg.hero_tagline,
    pkg.trip_style,
  ];
  const itinerary = pkg.itinerary_data as {
    days?: Array<{
      schedule?: Array<{
        activity?: string | null;
        note?: string | null;
        time?: string | null;
      } | null> | null;
    } | null> | null;
  } | null | undefined;
  for (const day of itinerary?.days ?? []) {
    for (const item of day?.schedule ?? []) {
      parts.push(item?.activity, item?.note, item?.time);
    }
  }
  return parts
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');
}

function duplicatePricePreference(pkg: SourcePriceRepairPackage): DuplicatePricePreference {
  const text = selectedVariantText(pkg);
  if (/(?:\ub77c\uc774\ud2b8|\uc2e4\uc18d|light|basic)/i.test(text)) return 'min';
  if (/(?:\uace0\s*\ud488\uaca9|\ud488\uaca9|premium|deluxe)/i.test(text)) return 'max';

  const hasTrainNumber = /\bG\s*\d{3,5}\b/i.test(text);
  if (hasTrainNumber) return 'max';

  const hasBus = /(?:\ub9ac\s*\ubb34\s*\uc9c4|\ubc84\s*\uc2a4\s*\uc774\s*\ub3d9|\uc77c\s*\ubc18\s*\ubc84\s*\uc2a4)/i.test(text);
  if (hasBus) return 'min';

  const hasHighSpeedRail = /(?:\uace0\s*\uc18d\s*\ucca0|\uace0\s*\uc18d\s*\uc5f4\s*\ucc28)/i.test(text);
  if (hasHighSpeedRail) return 'max';

  return null;
}

export function hasTransportPriceVariantCue(pkg: SourcePriceRepairPackage): boolean {
  return duplicatePricePreference(pkg) != null;
}

export function selectSourceBackedPriceRows(
  pkg: SourcePriceRepairPackage,
  rows: SourcePriceIRRow[],
): SourcePriceIRRow[] {
  return selectSourceBackedPriceRowsWithExclusions(pkg, rows).selected;
}

export function selectSourceBackedPriceRowsWithExclusions(
  pkg: SourcePriceRepairPackage,
  rows: SourcePriceIRRow[],
): { selected: SourcePriceIRRow[]; excludedPriceCandidates: ExcludedPriceCandidate[] } {
  const preference = duplicatePricePreference(pkg);
  const numericRows = rows.filter(row => Number.isFinite(row.adult_price) && row.adult_price > 0);
  const hasPackageSizedPrice = numericRows.some(row => row.adult_price >= PACKAGE_PRICE_FLOOR);
  const optionSizedRows = hasPackageSizedPrice
    ? numericRows.filter(row => row.adult_price <= OPTION_SIZED_PRICE_CEILING)
    : [];
  const candidateRows = hasPackageSizedPrice
    ? numericRows.filter(row => row.adult_price >= PACKAGE_PRICE_FLOOR)
    : numericRows;
  const byDate = new Map<string, SourcePriceIRRow[]>();
  for (const row of candidateRows) {
    if (!isIsoDate(row.date) || !Number.isFinite(row.adult_price) || row.adult_price <= 0) continue;
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  }

  const selected = [...byDate.values()]
    .map(candidates => {
      const sorted = [...candidates].sort((a, b) => a.adult_price - b.adult_price);
      if (preference === 'max') return sorted[sorted.length - 1];
      return sorted[0];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const selectedKeys = new Set(selected.map(row => `${row.date}:${row.adult_price}`));
  const excludedPriceCandidates: ExcludedPriceCandidate[] = [
    ...optionSizedRows.map(row => ({
      date: row.date,
      amount: row.adult_price,
      currency: 'KRW' as const,
      reason: 'option_sized_price_candidate' as const,
      sourceStatus: row.status ?? null,
    })),
    ...candidateRows
      .filter(row => isIsoDate(row.date) && !selectedKeys.has(`${row.date}:${row.adult_price}`))
      .map(row => ({
        date: row.date,
        amount: row.adult_price,
        currency: 'KRW' as const,
        reason: 'duplicate_variant_not_selected' as const,
        sourceStatus: row.status ?? null,
      })),
  ];

  return { selected, excludedPriceCandidates };
}

function inferPriceYear(pkg: SourcePriceRepairPackage, rawText: string): number {
  const sourceYear = resolvePriceRecoveryYear({ rawText });
  const dbYear = (pkg.price_dates ?? [])
    .map(row => (typeof row.date === 'string' ? Number(row.date.slice(0, 4)) : NaN))
    .find(year => Number.isFinite(year) && year >= 2000);
  if (sourceYear && dbYear && dbYear > sourceYear) {
    if (shouldPreferFutureDbPriceYear(pkg, rawText, sourceYear, dbYear)) return dbYear;
  }
  if (sourceYear) return sourceYear;

  if (dbYear) return dbYear;

  const rawYear = Number(rawText.match(/\b(20\d{2})\b/)?.[1] ?? 0);
  if (rawYear >= 2000) return rawYear;

  return new Date().getFullYear();
}

function expectedPriceDatesByDate(pkg: SourcePriceRepairPackage): {
  source: string;
  rows: PriceDate[];
  excludedPriceCandidates: ExcludedPriceCandidate[];
} {
  const referenceDate = sourceRepairReferenceDate(pkg);
  const rawText = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
  const rawExcludedPriceCandidates = extractExcludedPriceCandidatesFromRawText(rawText);
  if (rawText.length < 50) return { source: 'none', rows: [], excludedPriceCandidates: rawExcludedPriceCandidates };

  const departureDays = typeof pkg.departure_days === 'string'
    ? pkg.departure_days
    : inferDepartureDaysFromRawText(rawText);
  const ir = extractPriceIR(rawText, {
    year: inferPriceYear(pkg, rawText),
    title: pkg.title ?? undefined,
    durationDays: inferDurationDays(pkg),
    departureDays,
    accommodations: pkg.accommodations ?? [],
  });
  if (ir.source === 'none' || ir.rows.length === 0) return { source: ir.source, rows: [], excludedPriceCandidates: rawExcludedPriceCandidates };

  const byDate = new Map<string, PriceDate>();
  const selection = selectSourceBackedPriceRowsWithExclusions(pkg, ir.rows);
  for (const row of selection.selected) {
    if (!isIsoDate(row.date) || !Number.isFinite(row.adult_price) || row.adult_price <= 0) continue;
    if (!isUpcomingSourceDate(row.date, referenceDate)) continue;
    const current = byDate.get(row.date);
    if (current && current.price <= row.adult_price) continue;
    byDate.set(row.date, {
      date: row.date,
      price: row.adult_price,
      ...(typeof row.child_price === 'number' && row.child_price > 0 ? { child_price: row.child_price } : {}),
      confirmed: row.status === 'confirmed',
    });
  }

  return {
    source: ir.source,
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    excludedPriceCandidates: [
      ...rawExcludedPriceCandidates,
      ...selection.excludedPriceCandidates,
    ],
  };
}

export function buildSourceBackedPriceDateRepair(pkg: SourcePriceRepairPackage): SourceBackedPriceDateRepair {
  const referenceDate = sourceRepairReferenceDate(pkg);
  const expected = expectedPriceDatesByDate(pkg);
  const existingRows = Array.isArray(pkg.price_dates)
    ? pkg.price_dates.filter(row => !isIsoDate(row.date) || isUpcomingSourceDate(row.date, referenceDate))
    : [];
  const existingByDate = new Map<string, PriceDate>();

  if (expected.rows.length === 0) {
    return {
      status: 'unavailable',
      reason: 'source deterministic price table not recognized',
      source: expected.source,
      expectedCount: 0,
      existingCount: existingRows.length,
      addedCount: 0,
      excludedPriceCandidates: expected.excludedPriceCandidates,
    };
  }

  const expectedByDate = new Map(expected.rows.map(row => [row.date, row]));
  for (const row of existingRows) {
    if (!isIsoDate(row.date)) continue;
    const price = priceValue(row);
    if (price == null) {
      return {
        status: 'unsafe',
        reason: `existing price date has invalid price ${row.date}`,
        source: expected.source,
        expectedCount: expected.rows.length,
        existingCount: existingRows.length,
        addedCount: 0,
        excludedPriceCandidates: expected.excludedPriceCandidates,
      };
    }

    const expectedRow = expectedByDate.get(row.date);
    if (!expectedRow) {
      return {
        status: 'repaired',
        reason: `replaced price_dates with source-backed table because existing date ${row.date} is not present in source`,
        source: expected.source,
        expectedCount: expected.rows.length,
        existingCount: existingRows.length,
        addedCount: expected.rows.filter(expectedRow => !existingRows.some(existingRow => existingRow.date === expectedRow.date)).length,
        priceDates: expected.rows,
        excludedPriceCandidates: expected.excludedPriceCandidates,
      };
    }
    if (expectedRow.price !== price) {
      return {
        status: 'repaired',
        reason: `replaced price_dates with source-backed table because existing date ${row.date} price ${price} differs from source ${expectedRow.price}`,
        source: expected.source,
        expectedCount: expected.rows.length,
        existingCount: existingRows.length,
        addedCount: expected.rows.filter(expectedRow => !existingRows.some(existingRow => existingRow.date === expectedRow.date)).length,
        priceDates: expected.rows,
        excludedPriceCandidates: expected.excludedPriceCandidates,
      };
    }

    existingByDate.set(row.date, {
      date: row.date,
      price,
      ...(typeof row.child_price === 'number' && row.child_price > 0 ? { child_price: row.child_price } : {}),
      confirmed: row.confirmed === true || expectedRow.confirmed,
    });
  }

  const missing = expected.rows.filter(row => !existingByDate.has(row.date));
  if (missing.length === 0) {
    return {
      status: 'not_needed',
      reason: 'existing price_dates already match source-backed rows',
      source: expected.source,
      expectedCount: expected.rows.length,
      existingCount: existingRows.length,
      addedCount: 0,
      excludedPriceCandidates: expected.excludedPriceCandidates,
    };
  }

  const priceDates = [...existingByDate.values(), ...missing]
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    status: 'repaired',
    reason: `filled ${missing.length} missing source-backed departure dates`,
    source: expected.source,
    expectedCount: expected.rows.length,
    existingCount: existingRows.length,
    addedCount: missing.length,
    priceDates,
    excludedPriceCandidates: expected.excludedPriceCandidates,
  };
}
