import type { MatrixPriceRow, PriceIROptions } from './types.ts';

const DOW_MAP: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

const DOW_CHARS = '일월화수목금토';

function inferYearForMonth(month: number, explicitYear?: number): number {
  if (explicitYear && explicitYear >= 2000) return explicitYear;
  const now = new Date();
  return month < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear();
}

function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseKrwPrice(line: string): number {
  const match = line.trim().match(/^(\d{1,3}(?:,\d{3})*|\d{3,4})\s*(?:,-|원)?\s*$/);
  if (!match) return 0;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 10000 ? value * 1000 : value;
}

function parseDateRange(line: string): { sm: number; sd: number; em: number; ed: number } | null {
  const match = line.trim().match(/^(\d{1,2})[./](\d{1,2})\s*[~\-]\s*(\d{1,2})[./](\d{1,2})$/);
  if (!match) return null;
  return {
    sm: Number(match[1]),
    sd: Number(match[2]),
    em: Number(match[3]),
    ed: Number(match[4]),
  };
}

function parseDateTokens(line: string, yearHint?: number): string[] {
  const dates: string[] = [];
  let currentMonth: number | null = null;
  const tokens = line.match(/\d{1,2}[./]\d{1,2}|\d{1,2}/g) ?? [];

  for (const token of tokens) {
    const explicit = token.match(/^(\d{1,2})[./](\d{1,2})$/);
    if (explicit) {
      currentMonth = Number(explicit[1]);
      const iso = isoDate(inferYearForMonth(currentMonth, yearHint), currentMonth, Number(explicit[2]));
      if (iso) dates.push(iso);
      continue;
    }

    if (currentMonth != null) {
      const iso = isoDate(inferYearForMonth(currentMonth, yearHint), currentMonth, Number(token));
      if (iso) dates.push(iso);
    }
  }

  return [...new Set(dates)];
}

function requestedNights(options: PriceIROptions): number | null {
  const titleMatch = options.title?.match(/(\d+)\s*박/);
  if (titleMatch) return Number(titleMatch[1]);
  return options.durationDays && options.durationDays >= 4 ? options.durationDays - 2 : null;
}

function parseWeekdays(line: string, nights?: number | null): number[] {
  const compact = line.replace(/\s+/g, '');
  if (!compact) return [];

  const nightMatch = compact.match(/\((\d+)박\)|(\d+)박/);
  if (nightMatch && nights && Number(nightMatch[1] ?? nightMatch[2]) !== nights) {
    return [];
  }

  if (/매일/.test(compact)) return [0, 1, 2, 3, 4, 5, 6];
  if (!new RegExp(`^[${DOW_CHARS},/·()\\-0-9박]+$`).test(compact)) return [];

  const days = [...compact]
    .map(ch => DOW_MAP[ch])
    .filter((day): day is number => day != null);
  return [...new Set(days)];
}

function parseAllowedWeekdays(value?: string | string[] | null): Set<number> | null {
  if (!value) return null;
  const text = Array.isArray(value) ? value.join(',') : value;
  if (/매일/.test(text)) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const days = [...text]
    .map(ch => DOW_MAP[ch])
    .filter((day): day is number => day != null);
  return days.length > 0 ? new Set(days) : null;
}

function expandRangeByDow(
  startMonth: number,
  startDay: number,
  endMonth: number,
  endDay: number,
  weekdays: number[],
  yearHint?: number,
): string[] {
  const year = inferYearForMonth(startMonth, yearHint);
  const start = new Date(year, startMonth - 1, startDay);
  const end = new Date(year, endMonth - 1, endDay);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (weekdays.includes(cursor.getDay())) {
      const iso = isoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      if (iso) dates.push(iso);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function findSpotMarkerIndex(rawText: string): number {
  const markers = ['스팟특가', '스팟 특가', 'spot'];
  const lower = rawText.toLowerCase();
  for (const marker of markers) {
    const idx = lower.indexOf(marker.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function sliceSpotWeekdaySection(rawText: string): string {
  const start = findSpotMarkerIndex(rawText);
  if (start < 0) return '';

  let end = rawText.length;
  for (const marker of ['취소규정', '취소 수수료', '현금영수증', '예약금']) {
    const idx = rawText.indexOf(marker, start);
    if (idx >= 0 && idx < end) end = idx;
  }
  return rawText.slice(start, end);
}

function extractExcludedDates(section: string, yearHint?: number): Set<string> {
  const excluded = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    if (!/(제외일|항공제외|비운항)/.test(line)) continue;
    for (const date of parseDateTokens(line, yearHint)) excluded.add(date);
  }
  return excluded;
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function inferSelectedPriceColumn(rawText: string, options: PriceIROptions): number {
  const rawSource = [
    options.title ?? '',
    ...(options.accommodations ?? []),
  ].join(' ');
  if (/(품격|풀빌라|더비스타|2색|premium|villa)/i.test(rawSource)) return 1;
  if (/(알뜰|실속|3색|economy|standard)/i.test(rawSource)) return 0;

  const source = normalizeForMatch([
    options.title ?? '',
    ...(options.accommodations ?? []),
  ].join(' '));

  if (/(품격|풀빌라|더비스타|2색|premium|villa)/i.test(source)) return 1;
  if (/(알뜰|실속|3색|economy|standard)/i.test(source)) return 0;

  const markerIndex = findSpotMarkerIndex(rawText);
  if (markerIndex < 0) return 0;
  const headerLines = rawText
    .slice(Math.max(0, markerIndex - 800), markerIndex)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => parseKrwPrice(line) <= 0)
    .filter(line => parseDateTokens(line).length === 0)
    .filter(line => normalizeForMatch(line).length >= 4)
    .slice(-6);

  if (headerLines.length < 2 || !source) return 0;

  let bestIndex = 0;
  let bestScore = 0;
  for (let i = 0; i < headerLines.length; i++) {
    const label = normalizeForMatch(headerLines[i]);
    if (!label) continue;
    let score = 0;
    if (source.includes(label)) score += label.length;
    for (const token of label.match(/[\p{L}\p{N}]{2,}/gu) ?? []) {
      if (source.includes(token)) score += token.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = Math.min(i, 1);
    }
  }
  return bestScore > 0 ? bestIndex : 0;
}

function readConsecutivePrices(lines: string[], startIndex: number): { prices: number[]; endIndex: number } {
  const prices: number[] = [];
  let j = startIndex;
  while (j < lines.length) {
    const price = parseKrwPrice(lines[j]);
    if (price <= 0) break;
    prices.push(price);
    j++;
  }
  return { prices, endIndex: j - 1 };
}

export function extractSpotWeekdayRows(rawText: string, options: PriceIROptions = {}): MatrixPriceRow[] {
  const section = sliceSpotWeekdaySection(rawText);
  if (!section) return [];

  const lines = section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const excludedDates = extractExcludedDates(section, options.year);
  const allowedWeekdays = parseAllowedWeekdays(options.departureDays);
  const selectedColumn = inferSelectedPriceColumn(rawText, options);
  const nights = requestedNights(options);
  const byDate = new Map<string, MatrixPriceRow>();
  let pendingRanges: Array<{ sm: number; sd: number; em: number; ed: number; label: string }> = [];
  let pendingWeekdays: number[] = [];
  let rangeGroupConsumed = false;

  const addRow = (date: string, price: number, note: string) => {
    if (excludedDates.has(date)) return;
    if (allowedWeekdays && !allowedWeekdays.has(new Date(`${date}T00:00:00`).getDay())) return;
    const existing = byDate.get(date);
    if (existing?.note === '스팟특가' && note !== '스팟특가') return;
    byDate.set(date, {
      date,
      adult_price: price,
      child_price: null,
      note,
      status: 'available',
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(스팟특가|스팟\s*특가|실시간항공기준|\*)/i.test(line)) continue;
    if (/(추가일자|공휴일|그룹요금|예약시|추가\s*요금)/.test(line)) continue;

    const range = parseDateRange(line);
    if (range) {
      if (rangeGroupConsumed) {
        pendingRanges = [];
        rangeGroupConsumed = false;
      }
      pendingRanges.push({ ...range, label: line });
      pendingWeekdays = [];
      continue;
    }

    const weekdays = parseWeekdays(line, nights);
    if (pendingRanges.length > 0 && weekdays.length > 0) {
      pendingWeekdays = weekdays;
      continue;
    }

    const explicitDates = parseDateTokens(line, options.year);
    if (explicitDates.length > 0 && parseDateRange(line) == null) {
      const { prices, endIndex } = readConsecutivePrices(lines, i + 1);
      const selectedPrice = prices[selectedColumn] ?? prices[0] ?? 0;
      if (selectedPrice > 0) {
        for (const date of explicitDates) addRow(date, selectedPrice, '스팟특가');
        i = endIndex;
      }
      continue;
    }

    const price = parseKrwPrice(line);
    if (price <= 0) continue;

    if (pendingRanges.length > 0 && pendingWeekdays.length > 0) {
      const { prices, endIndex } = readConsecutivePrices(lines, i);
      const selectedPrice = prices[selectedColumn] ?? prices[0] ?? price;
      for (const pendingRange of pendingRanges) {
        for (const date of expandRangeByDow(
          pendingRange.sm,
          pendingRange.sd,
          pendingRange.em,
          pendingRange.ed,
          pendingWeekdays,
          options.year,
        )) {
          addRow(date, selectedPrice, pendingRange.label);
        }
      }
      pendingWeekdays = [];
      rangeGroupConsumed = true;
      i = endIndex;
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
