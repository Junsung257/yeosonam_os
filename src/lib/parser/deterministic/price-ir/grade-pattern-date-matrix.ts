import type { MatrixPriceRow, PriceIROptions } from './types.ts';

type GradeKey = 'save' | 'standard' | 'premium' | 'crown';

interface GradeLabel {
  key: GradeKey;
  label: string;
}

interface DateToken {
  month: number;
  day: number;
}

const GRADE_ALIASES: Record<GradeKey, string[]> = {
  save: ['세이브', '실속', 'save'],
  standard: ['스탠다드', '품격', 'standard'],
  premium: ['프리미엄', 'premium'],
  crown: ['크라운', 'crown'],
};

const PRICE_RE = /^(\d{1,3}(?:,\d{3})+|\d{5,8}|\d{3,4})(?:\s*원|\s*,-)?$/;
const MONTH_RE = /^(\d{1,2})월$/;
const WEEKDAY_RE = /^[월화수목금토일]요일$/;
const PATTERN_RE = /^(\d+)박\s*(\d+)일$/;
const DATE_RE = /^(\d{1,2})월\s*(\d{1,2})일(?:\s*\([월화수목금토일]\))?$/;

function compact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function parsePrice(line: string): number {
  const match = compact(line).match(PRICE_RE);
  if (!match) return 0;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 10000 ? value * 1000 : value;
}

function parseGradeLabel(line: string): GradeLabel | null {
  const value = compact(line);
  for (const [key, aliases] of Object.entries(GRADE_ALIASES) as Array<[GradeKey, string[]]>) {
    if (aliases.some(alias => value === compact(alias))) {
      return { key, label: line.trim() };
    }
  }
  return null;
}

function productScopedText(rawText: string): string {
  const parts = rawText.split(/^\s*---+\s*$/m).map(part => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] ?? rawText : rawText;
}

function inferGrade(options: PriceIROptions, rawText: string): GradeKey | null {
  const title = compact(options.title ?? '');
  for (const [key, aliases] of Object.entries(GRADE_ALIASES) as Array<[GradeKey, string[]]>) {
    if (aliases.some(alias => title.includes(compact(alias)))) return key;
  }

  const productLines = productScopedText(rawText).split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 12);
  const productHeader = compact(productLines.join(' '));
  for (const [key, aliases] of Object.entries(GRADE_ALIASES) as Array<[GradeKey, string[]]>) {
    if (aliases.some(alias => productHeader.includes(compact(alias)))) return key;
  }

  return null;
}

function inferPattern(options: PriceIROptions, rawText: string): string | null {
  const candidates = [options.title ?? '', productScopedText(rawText), rawText];
  for (const source of candidates) {
    const match = source.match(/(\d+)\s*박\s*(\d+)\s*일/);
    if (match) return `${Number(match[1])}박${Number(match[2])}일`;
  }
  if (options.durationDays && options.durationDays >= 2) {
    return `${options.durationDays - 1}박${options.durationDays}일`;
  }
  return null;
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function inferYear(month: number, explicitYear?: number): number {
  if (explicitYear && explicitYear >= 2000) return explicitYear;
  const now = new Date();
  return month < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear();
}

function findMatrixHeader(lines: string[]): { start: number; end: number; labels: GradeLabel[] } | null {
  for (let i = 0; i < lines.length; i++) {
    if (compact(lines[i]) !== '출발일') continue;

    const labels: GradeLabel[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const value = compact(lines[j]);
      if (value === '패턴') continue;
      const label = parseGradeLabel(lines[j]);
      if (!label) break;
      labels.push(label);
    }

    if (labels.length >= 2) return { start: i, end: j, labels };
  }
  return null;
}

function matchesPattern(currentPattern: string | null, targetPattern: string): boolean {
  return compact(currentPattern ?? '') === compact(targetPattern);
}

export function extractGradePatternDateMatrixRows(
  rawText: string,
  options: PriceIROptions = {},
): MatrixPriceRow[] {
  if (!rawText.includes('출발일') || !rawText.includes('패턴')) return [];

  const targetGrade = inferGrade(options, rawText);
  const targetPattern = inferPattern(options, rawText);
  if (!targetGrade || !targetPattern) return [];

  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const header = findMatrixHeader(lines);
  if (!header) return [];

  const selectedColumn = header.labels.findIndex(label => label.key === targetGrade);
  if (selectedColumn < 0) return [];

  const rowsByDate = new Map<string, MatrixPriceRow>();
  let currentMonth: number | null = null;
  let currentPattern: string | null = null;
  let pendingDates: DateToken[] = [];
  let lastPrices: number[] | null = null;

  const flushPending = () => {
    if (pendingDates.length === 0 || !lastPrices || !matchesPattern(currentPattern, targetPattern)) {
      pendingDates = [];
      return;
    }
    const price = lastPrices[selectedColumn] ?? 0;
    if (price <= 0) {
      pendingDates = [];
      return;
    }
    for (const token of pendingDates) {
      const date = isoDate(inferYear(token.month, options.year), token.month, token.day);
      if (!date) continue;
      rowsByDate.set(date, {
        date,
        adult_price: price,
        child_price: null,
        note: `${header.labels[selectedColumn]?.label ?? targetGrade} ${targetPattern}`,
        status: 'available',
      });
    }
    pendingDates = [];
  };

  const matrixEnd = lines.findIndex((line, index) => index > header.end && /^---+$/.test(line));
  const end = matrixEnd > header.end ? matrixEnd : lines.length;

  for (let i = header.end; i < end; i++) {
    const line = lines[i];

    const monthMatch = line.match(MONTH_RE);
    if (monthMatch) {
      flushPending();
      currentMonth = Number(monthMatch[1]);
      currentPattern = null;
      lastPrices = null;
      continue;
    }

    if (WEEKDAY_RE.test(line)) {
      flushPending();
      currentPattern = null;
      lastPrices = null;
      continue;
    }

    const patternMatch = line.match(PATTERN_RE);
    if (patternMatch) {
      flushPending();
      currentPattern = `${Number(patternMatch[1])}박${Number(patternMatch[2])}일`;
      lastPrices = null;
      continue;
    }

    const dateMatch = line.match(DATE_RE);
    if (dateMatch) {
      pendingDates.push({
        month: Number(dateMatch[1] ?? currentMonth),
        day: Number(dateMatch[2]),
      });
      continue;
    }

    const price = parsePrice(line);
    if (price <= 0) continue;

    const prices = [price];
    let j = i + 1;
    for (; j < end && prices.length < header.labels.length; j++) {
      const nextPrice = parsePrice(lines[j]);
      if (nextPrice <= 0) break;
      prices.push(nextPrice);
    }

    if (prices.length >= header.labels.length) {
      lastPrices = prices;
      flushPending();
      i = j - 1;
    }
  }

  flushPending();

  return [...rowsByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
