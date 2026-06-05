import type { MatrixPriceRow, PriceIROptions } from './types';

const PRICE_LINE_RE = /^([\d,]{3,10})\s*(?:원|[,，\-])?\s*$/;
const PRICE_RANGE_RE = /^(\d{1,2})[./](\d{1,2})\s*[~\-–—]\s*(\d{1,2})[./](\d{1,2})$/;
const LOOSE_PRICE_RANGE_RE = /(\d{1,2})[./](\d{1,2})[^\n~\-–—]*[~\-–—][^\n\d]*(\d{1,2})[./](\d{1,2})/;
const KOREAN_DOW_MAP: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

function parseKrwPrice(line: string): number {
  const match = line.trim().match(PRICE_LINE_RE);
  if (!match) return 0;
  const value = parseInt(match[1].replace(/[, ]/g, ''), 10);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 10000 ? value * 1000 : value;
}

function parseKrwAmountInText(line: string): number {
  const man = line.match(/(\d{1,4})\s*만\s*원/);
  if (man) return Number(man[1]) * 10000;
  const price = line.match(/([\d,]{4,10})\s*원/);
  if (price) return parseKrwPrice(price[1]);
  return 0;
}

function parseDateRangeInText(line: string): { sm: number; sd: number; em: number; ed: number } | null {
  const slash = line.match(LOOSE_PRICE_RANGE_RE) ?? line.match(PRICE_RANGE_RE);
  if (slash) {
    return {
      sm: Number(slash[1]),
      sd: Number(slash[2]),
      em: Number(slash[3]),
      ed: Number(slash[4]),
    };
  }

  const korean = line.match(/(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C?[^\n~\-–—]*[~\-–—][^\n\d]*(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C?/);
  if (!korean) return null;
  return {
    sm: Number(korean[1]),
    sd: Number(korean[2]),
    em: Number(korean[3]),
    ed: Number(korean[4]),
  };
}

function inferYearForMonth(month: number, explicitYear?: number): number {
  if (explicitYear && explicitYear >= 2000) return explicitYear;
  const now = new Date();
  const base = now.getFullYear();
  return month < now.getMonth() + 1 ? base + 1 : base;
}

function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
    if (weekdays.length === 0 || weekdays.includes(cursor.getDay())) {
      const iso = isoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
      if (iso) dates.push(iso);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function parseDateTokens(line: string, yearHint?: number): string[] {
  const dates: string[] = [];
  let currentMonth: number | null = null;
  const parts = line
    .split(/[,，&\s]+/)
    .map(part => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const explicit = part.match(/^(\d{1,2})[.](\d{1,2})$/) ?? part.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (explicit) {
      currentMonth = Number(explicit[1]);
      const day = Number(explicit[2]);
      const iso = isoDate(inferYearForMonth(currentMonth, yearHint), currentMonth, day);
      if (iso) dates.push(iso);
      continue;
    }

    const bareDay = part.match(/^\d{1,2}$/);
    if (bareDay && currentMonth != null) {
      const day = Number(part);
      const iso = isoDate(inferYearForMonth(currentMonth, yearHint), currentMonth, day);
      if (iso) dates.push(iso);
    }
  }
  return [...new Set(dates)];
}

function parseWeekdays(line: string): number[] {
  const days = new Set<number>();
  for (const ch of line) {
    const day = KOREAN_DOW_MAP[ch];
    if (day != null) days.add(day);
  }
  return [...days];
}

function sliceBeforeItinerary(rawText: string): string {
  const markers = ['\n일 자', '\n일자', '\n제1일', '\n제 1 일'];
  let end = rawText.length;
  for (const marker of markers) {
    const idx = rawText.indexOf(marker);
    if (idx >= 0 && idx < end) end = idx;
  }
  return rawText.slice(0, end);
}

export function extractWeekdayPeriodRows(rawText: string, options: PriceIROptions = {}): MatrixPriceRow[] {
  if (!rawText || !/(출\s*발\s*요\s*일|비운항|스\s*팟\s*특\s*가)/.test(rawText)) return [];
  const lines = sliceBeforeItinerary(rawText)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const rows: MatrixPriceRow[] = [];
  const spotRows: MatrixPriceRow[] = [];
  const excludedDates = new Set<string>();
  let inSpot = false;
  let inWeekday = false;
  let inExcluded = false;
  let inSurcharge = false;
  let weekdays: number[] = [];
  let pendingRanges: Array<{ sm: number; sd: number; em: number; ed: number; label: string }> = [];
  let pendingSurchargeRange: { sm: number; sd: number; em: number; ed: number; label: string } | null = null;
  const surchargeRanges: Array<{ sm: number; sd: number; em: number; ed: number; amount: number; label: string }> = [];
  const surchargeKeys = new Set<string>();

  const addSurchargeRange = (range: { sm: number; sd: number; em: number; ed: number; amount: number; label: string }) => {
    const key = `${range.sm}/${range.sd}-${range.em}/${range.ed}|${range.amount}`;
    if (surchargeKeys.has(key)) return;
    surchargeKeys.add(key);
    surchargeRanges.push(range);
  };

  const flushRanges = (price: number) => {
    if (price <= 0 || pendingRanges.length === 0) return;
    for (const range of pendingRanges) {
      for (const date of expandRangeByDow(range.sm, range.sd, range.em, range.ed, weekdays, options.year)) {
        if (excludedDates.has(date)) continue;
        rows.push({
          date,
          adult_price: price,
          child_price: null,
          note: range.label,
          status: 'available',
        });
      }
    }
    pendingRanges = [];
  };

  const applySurcharges = (row: MatrixPriceRow): MatrixPriceRow => {
    let extra = 0;
    const notes: string[] = [];
    for (const surcharge of surchargeRanges) {
      const dates = expandRangeByDow(
        surcharge.sm,
        surcharge.sd,
        surcharge.em,
        surcharge.ed,
        [],
        options.year,
      );
      if (dates.includes(row.date)) {
        extra += surcharge.amount;
        notes.push(`써차지 +${surcharge.amount.toLocaleString()}원`);
      }
    }
    if (extra <= 0) return row;
    return {
      ...row,
      adult_price: row.adult_price + extra,
      note: [row.note, ...notes].filter(Boolean).join(' | '),
    };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const compact = line.replace(/\s+/g, '');

    if (/^스팟특가$/.test(compact)) {
      inSpot = true;
      inWeekday = false;
      inExcluded = false;
      inSurcharge = false;
      continue;
    }
    if (/^출발요일$/.test(compact)) {
      inSpot = false;
      inWeekday = true;
      inExcluded = false;
      inSurcharge = false;
      continue;
    }
    if (/비운항/.test(line)) {
      inExcluded = true;
      inSurcharge = false;
      continue;
    }
    if (/써\s*챠\s*지|써\s*차\s*지|surcharge/i.test(line)) {
      inExcluded = false;
      inSurcharge = true;
      const inlineRange = parseDateRangeInText(line);
      const inlineAmount = parseKrwAmountInText(line);
      if (inlineRange && inlineAmount > 0) {
        addSurchargeRange({
          ...inlineRange,
          amount: inlineAmount,
          label: line,
        });
        inSurcharge = false;
      }
      continue;
    }

    if (inExcluded) {
      for (const date of parseDateTokens(line, options.year)) excludedDates.add(date);
      continue;
    }

    if (inSurcharge) {
      const surchargeRange = parseDateRangeInText(line);
      if (surchargeRange) {
        pendingSurchargeRange = {
          ...surchargeRange,
          label: line,
        };
        const inlineAmount = parseKrwAmountInText(line);
        if (inlineAmount > 0) {
          addSurchargeRange({
            ...pendingSurchargeRange,
            amount: inlineAmount,
          });
          pendingSurchargeRange = null;
          inSurcharge = false;
        }
        continue;
      }

      const amount = parseKrwAmountInText(line);
      if (amount > 0 && pendingSurchargeRange) {
        addSurchargeRange({
          ...pendingSurchargeRange,
          amount,
        });
        pendingSurchargeRange = null;
        inSurcharge = false;
        continue;
      }
    }

    if (inWeekday && /[월화수목금토일]\s*요일/.test(line) && /출발/.test(line)) {
      weekdays = parseWeekdays(line);
      continue;
    }

    if (inSpot && /\d{1,2}[./]\d{1,2}/.test(line)) {
      const dates = parseDateTokens(line, options.year);
      const sameLinePrice = parseKrwAmountInText(line);
      const nextPrice = sameLinePrice > 0 ? sameLinePrice : parseKrwPrice(lines[i + 1] ?? '');
      if (dates.length > 0 && nextPrice > 0) {
        for (const date of dates) {
          spotRows.push({
            date,
            adult_price: nextPrice,
            child_price: null,
            note: '스팟특가',
            status: 'available',
          });
        }
        if (sameLinePrice <= 0) i += 1;
      }
      continue;
    }

    if (!inWeekday) continue;

    const looseRange = parseDateRangeInText(line);
    const sameLineRangePrice = parseKrwAmountInText(line);
    if (looseRange && sameLineRangePrice > 0 && !/출발/.test(line)) {
      pendingRanges.push({
        ...looseRange,
        label: line.replace(/[\d,]{4,10}\s*원?/, '').trim(),
      });
      flushRanges(sameLineRangePrice);
      continue;
    }

    const range = parseDateRangeInText(line);
    if (range && !/출발/.test(line)) {
      pendingRanges.push({
        ...range,
        label: line,
      });
      continue;
    }

    const price = parseKrwPrice(line);
    if (price > 0 && !inSurcharge) {
      flushRanges(price);
    }
    if (price > 0 && inSurcharge && pendingRanges.length > 0) {
      flushRanges(price);
      inSurcharge = false;
    }
  }

  const byDate = new Map<string, MatrixPriceRow>();
  for (const row of rows) byDate.set(row.date, applySurcharges(row));
  for (const row of spotRows) byDate.set(row.date, applySurcharges(row));
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
