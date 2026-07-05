import type { PriceTier } from './price-table';

export type VerticalGradePriceGrade = 'economy' | 'standard' | 'premium';

interface VerticalGradePriceOptions {
  year?: number;
  grade?: VerticalGradePriceGrade | string | null;
  durationDays?: number | null;
  title?: string | null;
  departureDays?: string[] | null;
}

interface ParsedVerticalGradeRow {
  date: string;
  economyPrice: number;
  standardPrice: number | null;
  premiumPrice: number;
  prices: number[];
  note: string | null;
}

const DATE_LIST_RE = /^\d{1,2}[./]\d{1,2}(?:\s*,\s*(?:\d{1,2}[./])?\d{1,2})*$/;
const PRICE_RE = /^([\d,]{3,10})(?:\s*원|\s*[,\-])?$/;

function parsePrice(value: string): number {
  const n = parseInt(value.replace(/[, ]/g, ''), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 10000 ? n * 1000 : n;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function inferYear(rawText: string, explicitYear?: number): number {
  if (explicitYear && explicitYear >= 2000) return explicitYear;

  const yearMatch = rawText.match(/(?:^|[^\d])(\d{2,4})\s*년/);
  if (yearMatch) {
    const n = Number(yearMatch[1]);
    if (n >= 2000) return n;
    if (n >= 0 && n <= 99) return 2000 + n;
  }

  return new Date().getFullYear();
}

function parseDateList(line: string, year: number): string[] {
  const parts = line.replace(/\([^)]*\)/g, '').split(',').map(p => p.trim()).filter(Boolean);
  const dates: string[] = [];
  let currentMonth: number | null = null;

  for (const part of parts) {
    const slash = part.match(/^(\d{1,2})[./](\d{1,2})$/);
    if (slash) {
      currentMonth = Number(slash[1]);
      const iso = toIso(year, currentMonth, Number(slash[2]));
      if (iso) dates.push(iso);
      continue;
    }

    const bareDay = part.match(/^\d{1,2}$/);
    if (bareDay && currentMonth != null) {
      const iso = toIso(year, currentMonth, Number(part));
      if (iso) dates.push(iso);
    }
  }

  return dates;
}

function parsePriceLine(line: string): number {
  const m = line.match(PRICE_RE);
  return m ? parsePrice(m[1]) : 0;
}

function looksLikeDateList(line: string): boolean {
  return DATE_LIST_RE.test(line.replace(/\([^)]*\)/g, '').trim());
}

function findFirstVerticalPriceRow(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (!looksLikeDateList(lines[i])) continue;
    if (readPricePair(lines, i + 1)) return i;
  }
  return -1;
}

function readConsecutivePrices(lines: string[], startIndex: number): { prices: number[]; nextIndex: number } {
  const prices: number[] = [];
  let i = startIndex;
  for (; i < Math.min(lines.length, startIndex + 5); i++) {
    const price = parsePriceLine(lines[i] ?? '');
    if (price <= 0) break;
    prices.push(price);
  }
  return { prices, nextIndex: i };
}

function readPricePair(lines: string[], startIndex: number): {
  note: string | null;
  economyPrice: number;
  standardPrice: number | null;
  premiumPrice: number;
  prices: number[];
  nextIndex: number;
} | null {
  const direct = readConsecutivePrices(lines, startIndex);
  if (direct.prices.length >= 2) {
    return {
      note: null,
      economyPrice: direct.prices[0],
      standardPrice: direct.prices.length >= 3 ? direct.prices[1] : null,
      premiumPrice: direct.prices.length >= 3 ? direct.prices[2] : direct.prices[1],
      prices: direct.prices,
      nextIndex: direct.nextIndex,
    };
  }

  const maybeNote = lines[startIndex];
  const afterNote = readConsecutivePrices(lines, startIndex + 1);
  if (maybeNote && !looksLikeDateList(maybeNote) && afterNote.prices.length >= 2) {
    return {
      note: maybeNote,
      economyPrice: afterNote.prices[0],
      standardPrice: afterNote.prices.length >= 3 ? afterNote.prices[1] : null,
      premiumPrice: afterNote.prices.length >= 3 ? afterNote.prices[2] : afterNote.prices[1],
      prices: afterNote.prices,
      nextIndex: afterNote.nextIndex,
    };
  }

  return null;
}

function extractRows(rawText: string, options: VerticalGradePriceOptions = {}): ParsedVerticalGradeRow[] {
  if (!rawText || rawText.length < 30) return [];

  const year = inferYear(rawText, options.year);
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const start = findFirstVerticalPriceRow(lines);
  if (start < 0) return [];

  const rows: ParsedVerticalGradeRow[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!looksLikeDateList(line)) {
      if (rows.length > 0) break;
      i += 1;
      continue;
    }

    const dates = parseDateList(line, year);
    const pair = readPricePair(lines, i + 1);
    if (!pair || dates.length === 0) {
      if (rows.length > 0) break;
      i += 1;
      continue;
    }

    for (const date of dates) {
      rows.push({
        date,
        economyPrice: pair.economyPrice,
        standardPrice: pair.standardPrice,
        premiumPrice: pair.premiumPrice,
        prices: pair.prices,
        note: pair.note,
      });
    }
    i = pair.nextIndex;
  }

  return rows;
}

function weekdayForIso(date: string): string | null {
  const parts = date.split('-').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;
  const [year, month, day] = parts;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getUTCDay()] ?? null;
}

function inferDurationDaysFromText(text?: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d)\s*(?:박|\uBC15)\s*(\d)\s*(?:일|\uC77C)/);
  if (m) return Number(m[2]);
  if (/3\s*(?:박|\uBC15)/.test(text)) return 5;
  if (/4\s*(?:박|\uBC15)/.test(text)) return 6;
  return null;
}

function durationDaysFromNote(note?: string | null): number | null {
  if (!note) return null;
  if (/^\s*3|3\s*(?:박|\uBC15)/.test(note)) return 5;
  if (/^\s*4|4\s*(?:박|\uBC15)/.test(note)) return 6;
  return null;
}

function normalizeDepartureDay(day: string): string | null {
  const lower = day.trim().toLowerCase();
  if (/^(sun|일|\uC77C)/.test(lower)) return 'sun';
  if (/^(mon|월|\uC6D4)/.test(lower)) return 'mon';
  if (/^(tue|화|\uD654)/.test(lower)) return 'tue';
  if (/^(wed|수|\uC218)/.test(lower)) return 'wed';
  if (/^(thu|목|\uBAA9)/.test(lower)) return 'thu';
  if (/^(fri|금|\uAE08)/.test(lower)) return 'fri';
  if (/^(sat|토|\uD1A0)/.test(lower)) return 'sat';
  return null;
}

function targetWeekdays(options: VerticalGradePriceOptions): Set<string> | null {
  const explicit = options.departureDays
    ?.map(normalizeDepartureDay)
    .filter((day): day is string => Boolean(day));
  if (explicit?.length) return new Set(explicit);

  const durationDays = options.durationDays ?? inferDurationDaysFromText(options.title);
  if (durationDays === 5) return new Set(['wed', 'thu']);
  if (durationDays === 6) return new Set(['sat', 'sun']);
  return null;
}

function filterRowsByDuration(rows: ParsedVerticalGradeRow[], options: VerticalGradePriceOptions): ParsedVerticalGradeRow[] {
  if (rows.some(row => row.prices.length >= 3)) return rows;
  const durationDays = options.durationDays ?? inferDurationDaysFromText(options.title);
  const weekdays = targetWeekdays(options);
  if (!durationDays && !weekdays) return rows;

  return rows.filter(row => {
    const noteDuration = durationDaysFromNote(row.note);
    if (noteDuration) return durationDays ? noteDuration === durationDays : true;
    if (!weekdays) return true;
    const weekday = weekdayForIso(row.date);
    return weekday ? weekdays.has(weekday) : true;
  });
}

export function inferVerticalGradeFromText(text?: string | null): VerticalGradePriceGrade | undefined {
  if (!text) return undefined;
  if (/고품격|노옵션|프리미엄|premium/i.test(text)) return 'premium';
  if (/실속|기본|economy|standard/i.test(text)) return 'economy';
  return undefined;
}

function normalizeGrade(grade?: VerticalGradePriceOptions['grade']): VerticalGradePriceGrade {
  if (grade === 'premium' || (typeof grade === 'string' && /고품격|노옵션|프리미엄|premium/i.test(grade))) {
    return 'premium';
  }
  return 'economy';
}

function resolveVerticalGrade(options: VerticalGradePriceOptions): VerticalGradePriceGrade {
  const title = options.title ?? '';
  if (/프리미엄|premium/i.test(title)) return 'premium';
  if (/스탠다드|standard/i.test(title)) return 'standard';
  if (/세이브|실속|economy|save/i.test(title)) return 'economy';
  const grade = options.grade;
  if (grade === 'premium' || (typeof grade === 'string' && /프리미엄|premium/i.test(grade))) return 'premium';
  if (grade === 'standard' || (typeof grade === 'string' && /스탠다드|standard/i.test(grade))) return 'standard';
  return normalizeGrade(grade);
}

function priceForGrade(row: ParsedVerticalGradeRow, grade: VerticalGradePriceGrade): number {
  if (row.prices.length >= 3) {
    if (grade === 'premium') return row.prices[2] ?? 0;
    if (grade === 'standard') return row.prices[1] ?? 0;
    return row.prices[0] ?? 0;
  }
  if (grade === 'premium') return row.premiumPrice;
  if (grade === 'standard') return row.standardPrice ?? row.premiumPrice;
  return row.economyPrice;
}

function resolveVerticalGradeStable(options: VerticalGradePriceOptions): VerticalGradePriceGrade {
  const title = options.title ?? '';
  if (/\uD504\uB9AC\uBBF8\uC5C4|premium/i.test(title)) return 'premium';
  if (/\uC2A4\uD0E0\uB2E4\uB4DC|standard/i.test(title)) return 'standard';
  if (/\uC138\uC774\uBE0C|\uC2E4\uC18D|economy|save/i.test(title)) return 'economy';
  const grade = options.grade;
  if (grade === 'premium' || (typeof grade === 'string' && /\uD504\uB9AC\uBBF8\uC5C4|premium/i.test(grade))) return 'premium';
  if (grade === 'standard' || (typeof grade === 'string' && /\uC2A4\uD0E0\uB2E4\uB4DC|standard/i.test(grade))) return 'standard';
  return resolveVerticalGrade(options);
}

/**
 * Extracts vertical spot price tables where each departure date is followed by
 * two grade prices, usually "economy/basic" then "premium/no-option".
 */
export function extractVerticalGradePriceTable(rawText: string, options: VerticalGradePriceOptions = {}): PriceTier[] {
  const rows = filterRowsByDuration(extractRows(rawText, options), options);
  if (rows.length === 0) return [];

  const grade = resolveVerticalGradeStable(options);
  const gradeLabel = grade === 'premium' ? '고품격' : grade === 'standard' ? '스탠다드' : '실속';
  const byKey = new Map<string, { price: number; note: string | null; dates: string[] }>();

  for (const row of rows) {
    const price = priceForGrade(row, grade);
    if (price <= 0) continue;
    const key = `${price}|${row.note ?? ''}`;
    const group = byKey.get(key) ?? { price, note: row.note, dates: [] };
    group.dates.push(row.date);
    byKey.set(key, group);
  }

  return [...byKey.values()].map(group => ({
    period_label: `${gradeLabel}${group.note ? ` ${group.note}` : ' 스팟특가'}`,
    departure_dates: [...new Set(group.dates)].sort(),
    departure_day_of_week: null,
    date_range: null,
    adult_price: group.price,
    child_price: null,
    status: 'available',
    note: group.note,
  }));
}
