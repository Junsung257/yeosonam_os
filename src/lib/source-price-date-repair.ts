import { extractPriceIR } from '@/lib/parser/deterministic/price-ir';
import type { PriceDate } from '@/lib/price-dates';
import { inferDepartureDaysFromRawText } from '@/lib/product-registration/departure-days';
import { resolvePriceRecoveryYear } from '@/lib/product-registration/price-year';

export type SourcePriceRepairPackage = {
  id?: string | null;
  title?: string | null;
  duration?: number | null;
  raw_text?: string | null;
  accommodations?: string[] | null;
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
    }
  | {
      status: 'repaired';
      reason: string;
      source: string;
      expectedCount: number;
      existingCount: number;
      addedCount: number;
      priceDates: PriceDate[];
    };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_RE.test(value);
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
} {
  const rawText = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
  if (rawText.length < 50) return { source: 'none', rows: [] };

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
  if (ir.source === 'none' || ir.rows.length === 0) return { source: ir.source, rows: [] };

  const byDate = new Map<string, PriceDate>();
  for (const row of ir.rows) {
    if (!isIsoDate(row.date) || !Number.isFinite(row.adult_price) || row.adult_price <= 0) continue;
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
  };
}

export function buildSourceBackedPriceDateRepair(pkg: SourcePriceRepairPackage): SourceBackedPriceDateRepair {
  const expected = expectedPriceDatesByDate(pkg);
  const existingRows = Array.isArray(pkg.price_dates) ? pkg.price_dates : [];
  const existingByDate = new Map<string, PriceDate>();

  if (expected.rows.length === 0) {
    return {
      status: 'unavailable',
      reason: 'source deterministic price table not recognized',
      source: expected.source,
      expectedCount: 0,
      existingCount: existingRows.length,
      addedCount: 0,
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
  };
}
