import type { PriceTier } from './price-table';

export type VerticalGradePriceGrade = 'economy' | 'premium';

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
  premiumPrice: number;
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
  const parts = line.split(',').map(p => p.trim()).filter(Boolean);
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
  return DATE_LIST_RE.test(line.trim());
}

function findFirstVerticalPriceRow(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (!looksLikeDateList(lines[i])) continue;
    if (readPricePair(lines, i + 1)) return i;
  }
  return -1;
}

function readPricePair(lines: string[], startIndex: number): { note: string | null; economyPrice: number; premiumPrice: number; nextIndex: number } | null {
  let i = startIndex;
  let note: string | null = null;

  const first = parsePriceLine(lines[i] ?? '');
  const second = parsePriceLine(lines[i + 1] ?? '');
  if (first > 0 && second > 0) {
    return { note, economyPrice: first, premiumPrice: second, nextIndex: i + 2 };
  }

  const maybeNote = lines[i];
  const afterNoteFirst = parsePriceLine(lines[i + 1] ?? '');
  const afterNoteSecond = parsePriceLine(lines[i + 2] ?? '');
  if (maybeNote && !looksLikeDateList(maybeNote) && afterNoteFirst > 0 && afterNoteSecond > 0) {
    note = maybeNote;
    i += 1;
    return { note, economyPrice: afterNoteFirst, premiumPrice: afterNoteSecond, nextIndex: i + 2 };
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
        premiumPrice: pair.premiumPrice,
        note: pair.note,
      });
    }
    i = pair.nextIndex;
  }

  return rows;
}

function weekdayForIso(date: string): string | null {
  const d = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return null;
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()] ?? null;
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

/**
 * Extracts vertical spot price tables where each departure date is followed by
 * two grade prices, usually "economy/basic" then "premium/no-option".
 */
export function extractVerticalGradePriceTable(rawText: string, options: VerticalGradePriceOptions = {}): PriceTier[] {
  const rows = filterRowsByDuration(extractRows(rawText, options), options);
  if (rows.length === 0) return [];

  const grade = normalizeGrade(options.grade);
  const gradeLabel = grade === 'premium' ? '고품격' : '실속';
  const byKey = new Map<string, { price: number; note: string | null; dates: string[] }>();

  for (const row of rows) {
    const price = grade === 'premium' ? row.premiumPrice : row.economyPrice;
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
