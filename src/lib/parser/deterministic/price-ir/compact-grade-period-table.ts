import type { MatrixPriceRow, PriceIROptions } from './types';

type PeriodSlot = {
  sm: number;
  sd: number;
  em: number;
  ed: number;
  label: string;
};

const DOW_MAP: Record<string, number> = {
  '\uC77C': 0,
  '\uC6D4': 1,
  '\uD654': 2,
  '\uC218': 3,
  '\uBAA9': 4,
  '\uAE08': 5,
  '\uD1A0': 6,
};
const DOW_CHARS = '\uC77C\uC6D4\uD654\uC218\uBAA9\uAE08\uD1A0';
const PERIOD_RE = /(\d{1,2})[./](\d{1,2})\s*[~\-–—]\s*(?:(\d{1,2})[./])?(\d{1,2})/g;
const PRICE_RE = /^(\d{1,3}(?:,\d{3})?|\d{3,4})\s*(?:,-|원)?\s*$/;

function inferYearForMonth(month: number, explicitYear?: number): number {
  if (explicitYear && explicitYear >= 2000) return explicitYear;
  const now = new Date();
  return month < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear();
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parsePrice(line: string): number {
  const match = line.trim().match(PRICE_RE);
  if (!match) return 0;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 10000 ? value * 1000 : value;
}

function parsePeriods(line: string): PeriodSlot[] {
  const periods: PeriodSlot[] = [];
  for (const match of line.matchAll(PERIOD_RE)) {
    const sm = Number(match[1]);
    const sd = Number(match[2]);
    const em = Number(match[3] ?? match[1]);
    const ed = Number(match[4]);
    if (![sm, sd, em, ed].every(Number.isFinite)) continue;
    periods.push({ sm, sd, em, ed, label: match[0] });
  }
  return periods;
}

function normalizeWeekdayLine(line: string): string {
  return line
    .replace(/\s+/g, '')
    .replace(/요일/g, '')
    .replace(/[,/·ㆍ]/g, '');
}

function parseWeekdays(line: string): number[] {
  const compact = normalizeWeekdayLine(line);
  if (!compact || !new RegExp(`^[${DOW_CHARS}]+$`).test(compact)) return [];
  return [...new Set([...compact].map(ch => DOW_MAP[ch]).filter((day): day is number => day != null))];
}

function isWeekdayLine(line: string): boolean {
  return parseWeekdays(line).length > 0;
}

function sliceSharedPriceRegion(rawText: string): string {
  const periodIndex = rawText.search(PERIOD_RE);
  if (periodIndex < 0) return '';

  let end = rawText.length;
  for (const marker of ['\n---\n', '\nPKG\n', '\n일 자\n', '\n포함사항\n']) {
    const idx = rawText.indexOf(marker, periodIndex);
    if (idx >= 0 && idx < end) end = idx;
  }
  return rawText.slice(0, end);
}

function normalizeLines(region: string): string[] {
  const newlineCount = (region.match(/\n/g) ?? []).length;
  const value = newlineCount >= 5
    ? region
    : region
      .replace(PERIOD_RE, '\n$&\n')
      .replace(new RegExp(`\\b([${DOW_CHARS}](?:[,/][${DOW_CHARS}]){0,3})\\b`, 'g'), '\n$1\n')
      .replace(/(\d{1,3}(?:,\d{3})?|\d{3,4})\s*,-/g, '\n$&\n');

  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function isStopLine(line: string): boolean {
  return /\bPKG\b/i.test(line)
    || /^-{3,}$/.test(line)
    || /^(포함사항|불포함사항|옵션안내|주의사항|일\s*자)$/.test(line)
    || /예약시|항공그룹요금/.test(line);
}

function isLabelCandidate(line: string): boolean {
  if (line.length > 40) return false;
  if (parsePrice(line) > 0) return false;
  if (parsePeriods(line).length > 0) return false;
  if (isWeekdayLine(line)) return false;
  if (/제외일|써차지|추가\s*기간/.test(line)) return false;
  return /[\p{L}\p{N}]/u.test(line);
}

function readLabelsAndPrices(lines: string[], startIndex: number): {
  labels: string[];
  prices: number[];
  endIndex: number;
} {
  const labels: string[] = [];
  const prices: number[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];
    if (isStopLine(line) || parsePeriods(line).length > 0 || isWeekdayLine(line)) break;
    const price = parsePrice(line);
    if (price > 0) {
      while (i < lines.length) {
        const nextPrice = parsePrice(lines[i]);
        if (nextPrice <= 0) break;
        prices.push(nextPrice);
        i++;
      }
      break;
    }
    if (isLabelCandidate(line)) labels.push(line);
    i++;
  }

  return { labels, prices, endIndex: Math.max(startIndex, i) - 1 };
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function scoreLabel(label: string, source: string): number {
  const normalizedLabel = normalizeForMatch(label);
  if (!normalizedLabel || !source) return 0;

  let score = 0;
  if (source.includes(normalizedLabel)) score += normalizedLabel.length * 10;
  for (const token of label.split(/[+/·ㆍ\s]+/).map(normalizeForMatch).filter(Boolean)) {
    if (token.length >= 2 && source.includes(token)) score += token.length * 6;
  }
  if (/실속/.test(label) && /실속|세이브|스탠다드/.test(source)) score += 80;
  if (/베이토우|미식/.test(label) && /베이토우|미식|야류/.test(source)) score += 80;
  if (/노팁|노옵션|노쇼핑/.test(label) && /노팁|노옵션|노쇼핑|노노노/.test(source)) score += 100;
  return score;
}

function selectColumn(labels: string[], options: PriceIROptions): number {
  if (labels.length === 0) return 0;
  const source = normalizeForMatch([
    options.title ?? '',
    ...(options.accommodations ?? []),
  ].join(' '));
  if (!source) return 0;

  let bestIndex = 0;
  let bestScore = -1;
  labels.forEach((label, index) => {
    const score = scoreLabel(label, source);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestScore > 0 ? bestIndex : 0;
}

function expandPeriodByWeekday(period: PeriodSlot, weekdays: number[], price: number, options: PriceIROptions): MatrixPriceRow[] {
  const year = inferYearForMonth(period.sm, options.year);
  const endYear = period.em < period.sm ? year + 1 : year;
  const start = new Date(year, period.sm - 1, period.sd);
  const end = new Date(endYear, period.em - 1, period.ed);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const rows: MatrixPriceRow[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (weekdays.includes(cursor.getDay())) {
      const iso = toIsoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      if (iso) {
        rows.push({
          date: iso,
          adult_price: price,
          child_price: null,
          note: period.label,
          status: 'available',
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

function addExcludedRange(
  excluded: Set<string>,
  month: number,
  startDay: number,
  endDay: number,
  options: PriceIROptions,
): void {
  const year = inferYearForMonth(month, options.year);
  for (let day = startDay; day <= endDay; day++) {
    const iso = toIsoDate(year, month, day);
    if (iso) excluded.add(iso);
  }
}

function parseExcludedDates(lines: string[], options: PriceIROptions): Set<string> {
  const excluded = new Set<string>();
  let currentMonth: number | null = null;
  const exclusionText = lines.filter(line => /제외일/.test(line)).join(' ');
  const tokenRe = /(\d{1,2})[./](\d{1,2})(?:\s*[~\-–—]\s*(?:(\d{1,2})[./])?(\d{1,2}))?|(?<![./])\b(\d{1,2})(?:\s*[~\-–—]\s*(\d{1,2}))?\b/g;

  for (const match of exclusionText.matchAll(tokenRe)) {
    if (match[1] && match[2]) {
      const month = Number(match[1]);
      const startDay = Number(match[2]);
      const endMonth = Number(match[3] ?? match[1]);
      const endDay = Number(match[4] ?? match[2]);
      currentMonth = endMonth;
      if (month !== endMonth) continue;
      addExcludedRange(excluded, month, startDay, endDay, options);
      continue;
    }

    if (match[5] && currentMonth != null) {
      const startDay = Number(match[5]);
      const endDay = Number(match[6] ?? match[5]);
      addExcludedRange(excluded, currentMonth, startDay, endDay, options);
    }
  }
  return excluded;
}

export function extractCompactGradePeriodRows(rawText: string, options: PriceIROptions = {}): MatrixPriceRow[] {
  const region = sliceSharedPriceRegion(rawText);
  if (!region || !/(실속|노팁|노옵션|노쇼핑|미식|베이토우)/.test(region)) return [];

  const lines = normalizeLines(region);
  const excludedDates = parseExcludedDates(lines, options);
  const rows: MatrixPriceRow[] = [];
  let periods: PeriodSlot[] = [];
  let labels: string[] = [];
  let priceGenerated = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isStopLine(line)) break;
    if (/제외일|써차지|추가\s*기간/.test(line)) continue;

    const parsedPeriods = parsePeriods(line);
    if (parsedPeriods.length > 0) {
      if (priceGenerated) {
        periods = [];
        priceGenerated = false;
      }
      periods.push(...parsedPeriods);
      continue;
    }

    const weekdays = parseWeekdays(line);
    if (weekdays.length === 0 || periods.length === 0) continue;

    const group = readLabelsAndPrices(lines, i + 1);
    if (group.prices.length < 2) continue;
    if (labels.length === 0 && group.labels.length >= group.prices.length) {
      labels = group.labels.slice(0, group.prices.length);
    }

    const selectedColumn = selectColumn(labels, options);
    const selectedPrice = group.prices[selectedColumn] ?? group.prices[0] ?? 0;
    if (selectedPrice <= 0) continue;

    for (const period of periods) {
      rows.push(...expandPeriodByWeekday(period, weekdays, selectedPrice, options));
    }
    priceGenerated = true;
    i = group.endIndex;
  }

  const byDate = new Map<string, MatrixPriceRow>();
  for (const row of rows) {
    if (excludedDates.has(row.date)) continue;
    if (!byDate.has(row.date)) byDate.set(row.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
