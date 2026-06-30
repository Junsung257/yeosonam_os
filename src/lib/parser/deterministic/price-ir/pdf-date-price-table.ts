import type { MatrixPriceRow, PriceIROptions } from './types.ts';

const WON = '\uC6D0';
const MONTH_KO = '\uC6D4';
const MONTH_CJK = '\u6708';

const EXCLUDED_CONTEXT_RE = new RegExp([
  '\uD3EC\uD568',
  '\uBD88\uD3EC\uD568',
  '\uAC00\uC774\uB4DC',
  '\uC720\uB958',
  '\uC2F1\uAE00',
  '\uC1FC\uD551',
  '\uC635\uC158',
  '\uC120\uD0DD\uAD00\uAD11',
  '\uBCF4\uD5D8',
  '\uCDE8\uC18C',
  '\uD658\uBD88',
  '\uD328\uB110\uD2F0',
  '\uC608\uC57D\uAE08',
  '\uAC1C\uC778\uACBD\uBE44',
  '\uCD94\uAC00',
].join('|'));

function inferYearForMonth(month: number, explicitYear?: number): number {
  if (explicitYear && explicitYear >= 2000) return explicitYear;
  const now = new Date();
  return month < now.getMonth() + 1 ? now.getFullYear() + 1 : now.getFullYear();
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parsePrice(value: string): number | null {
  const price = Number(value.replace(/[^\d]/g, ''));
  if (!Number.isInteger(price) || price < 250_000 || price > 8_000_000) return null;
  return price;
}

function normalizeLine(line: string): string {
  return line
    .replace(new RegExp(`,\\s*${WON}\\s*(\\d{3})`, 'g'), ',$1')
    .replace(new RegExp(`(\\d{3,4})\\s*${WON}\\s*,\\s*(\\d{3})`, 'g'), '$1,$2')
    .replace(new RegExp(`(\\d{1,3}(?:,\\d{3})+)\\s*${WON}`, 'g'), '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasPrice(line: string): boolean {
  return /(?:\d{1,3}(?:,\d{3})+|\d{5,8})/.test(normalizeLine(line));
}

function hasDateHint(line: string): boolean {
  return /\d{1,2}\s*\/\s*\d{1,2}/.test(line) || /^\s*\d{1,2}(?:\s*,\s*\d{1,2})+\s*$/.test(line);
}

function isDepartureDateCandidateLine(line: string): boolean {
  return hasDateHint(line) && !/[\uBC1C\uAD8C\uB9C8\uAC10\uAE4C\uC9C0]/.test(line);
}

function prepareLines(rawText: string): string[] {
  const sourceLines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const priceJoined: string[] = [];

  for (let i = 0; i < sourceLines.length; i++) {
    const current = sourceLines[i];
    const next = sourceLines[i + 1]?.trim() ?? '';
    if (/,\s*(?:\uC6D0)?\s*$/.test(current) && /^\d{3}(?:\s*\uC6D0)?(?:\s*\/\s*\S+)?$/.test(next)) {
      priceJoined.push(`${current}${next}`);
      i++;
      continue;
    }
    priceJoined.push(current);
  }

  const lines: string[] = [];
  for (let i = 0; i < priceJoined.length; i++) {
    const current = priceJoined[i];
    const next = priceJoined[i + 1] ?? '';
    const afterNext = priceJoined[i + 2] ?? '';
    if (
      isDepartureDateCandidateLine(current)
      && !hasPrice(current)
      && isDepartureDateCandidateLine(next)
      && !hasPrice(next)
      && hasPrice(afterNext)
      && !hasDateHint(afterNext)
    ) {
      lines.push(`${current} ${next} ${afterNext}`);
      i += 2;
      continue;
    }
    if (isDepartureDateCandidateLine(current) && !hasPrice(current) && hasPrice(next) && !hasDateHint(next)) {
      lines.push(`${current} ${next}`);
      i++;
      continue;
    }
    lines.push(current);
  }

  return lines.map(normalizeLine).filter(Boolean);
}

function monthFromHeader(line: string): number | null {
  const cjk = line.match(new RegExp(`^\\s*(\\d{1,2})\\s*${MONTH_CJK}`));
  if (cjk) return Number(cjk[1]);
  const koPrefix = line.match(new RegExp(`^\\s*${MONTH_KO}\\s*(\\d{1,2})\\b`));
  if (koPrefix) return Number(koPrefix[1]);
  const koSuffix = line.match(new RegExp(`^\\s*(\\d{1,2})\\s*${MONTH_KO}\\b`));
  if (koSuffix) return Number(koSuffix[1]);
  return null;
}

function expandRange(year: number, month: number, startDay: number, endMonth: number, endDay: number): string[] {
  const start = new Date(year, month - 1, startDay);
  const endYear = endMonth < month ? year + 1 : year;
  const end = new Date(endYear, endMonth - 1, endDay);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && dates.length < 370) {
    dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function dateObjectsFromSegment(segment: string, fallbackYear: number, fallbackMonth: number | null, extraBareDay?: number): string[] {
  const dates: string[] = [];
  const seen = new Set<string>();
  let activeMonth = fallbackMonth;
  let cleaned = segment;

  const push = (date: string | null) => {
    if (!date || seen.has(date)) return;
    seen.add(date);
    dates.push(date);
  };

  cleaned = cleaned
    .replace(/\d+\s*\uC778/g, ' ')
    .replace(/\uC131\uC778\s*\d+/g, ' ');

  cleaned = cleaned.replace(/(\d{1,2})\s*\/\s*(\d{1,2})\s*~\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2})/g, (match, monthText, startDayText, endMonthText, endDayText) => {
    const month = Number(monthText);
    const startDay = Number(startDayText);
    const endMonth = endMonthText ? Number(endMonthText) : month;
    const endDay = Number(endDayText);
    const year = inferYearForMonth(month, fallbackYear);
    for (const date of expandRange(year, month, startDay, endMonth, endDay)) push(date);
    activeMonth = month;
    return ' ';
  });

  cleaned = cleaned.replace(/(\d{1,2})\s*\/\s*(\d{1,2})/g, (match, monthText, dayText) => {
    const month = Number(monthText);
    const day = Number(dayText);
    push(isoDate(inferYearForMonth(month, fallbackYear), month, day));
    activeMonth = month;
    return ' ';
  });

  for (const match of cleaned.matchAll(/(?:^|[^\d])(\d{1,2})(?=$|[^\d])/g)) {
    if (!activeMonth) continue;
    const day = Number(match[1]);
    if (day < 1 || day > 31) continue;
    push(isoDate(inferYearForMonth(activeMonth, fallbackYear), activeMonth, day));
  }

  if (extraBareDay && activeMonth) {
    push(isoDate(inferYearForMonth(activeMonth, fallbackYear), activeMonth, extraBareDay));
  }

  return dates.sort();
}

function splitConcatenatedTail(line: string): {
  dateSegment: string;
  price: number;
  extraBareDay: number;
  extraMonth: number | null;
} | null {
  const match = line.match(/^(.*?)(\d{2,7}(?:,\d{3}){1,2})(?:\s*\uC6D0)?(?:\s*\/\s*\S+)?$/);
  if (!match) return null;
  let beforeTail = match[1];
  const tail = match[2];
  const firstComma = tail.indexOf(',');
  if (firstComma < 2) return null;
  const prefixDigits = tail.slice(0, firstComma);
  const suffix = tail.slice(firstComma);
  const danglingMonth = beforeTail.match(/(\d{1,2})\s*\/\s*$/);
  const extraMonth = danglingMonth ? Number(danglingMonth[1]) : null;
  if (danglingMonth) beforeTail = beforeTail.slice(0, danglingMonth.index).trim();

  for (const dayLength of [2, 1]) {
    if (prefixDigits.length < dayLength) continue;
    const day = Number(prefixDigits.slice(0, dayLength));
    const pricePrefix = prefixDigits.slice(dayLength);
    const inferredMillionPrice = pricePrefix.length === 0 && /^,\d{3},\d{3}$/.test(suffix)
      ? parsePrice(`1${suffix}`)
      : null;
    const price = inferredMillionPrice ?? parsePrice(`${pricePrefix}${suffix}`);
    if (!Number.isInteger(day) || day < 1 || day > 31 || !price) continue;
    return {
      dateSegment: beforeTail,
      price,
      extraBareDay: day,
      extraMonth,
    };
  }

  return null;
}

function rowsFromSpacedMonthDayPriceLine(line: string, fallbackYear: number): MatrixPriceRow[] {
  const rows: MatrixPriceRow[] = [];
  const seen = new Set<string>();
  const spacedRe = /(?:^|[^\d])(\d{1,2})\s*(?:월)?\s+((?:\d{1,2}\s*(?:,|일)?\s*){1,16})\s*(?:일)?\s+((?:\d{1,3}(?:,\d{3})+|\d{5,8})(?:\s+(?:\d{1,3}(?:,\d{3})+|\d{5,8}))*)/g;

  for (const match of line.matchAll(spacedRe)) {
    const month = Number(match[1]);
    if (month < 1 || month > 12) continue;
    const days = [...match[2].matchAll(/\d{1,2}/g)]
      .map(dayMatch => Number(dayMatch[0]))
      .filter(day => day >= 1 && day <= 31);
    if (days.length === 0) continue;
    const prices = [...match[3].matchAll(/\d{1,3}(?:,\d{3})+|\d{5,8}/g)]
      .map(priceMatch => parsePrice(priceMatch[0]))
      .filter((price): price is number => price != null);
    if (prices.length === 0) continue;

    for (const day of days) {
      const date = isoDate(inferYearForMonth(month, fallbackYear), month, day);
      if (!date) continue;
      for (const price of prices) {
        const key = `${date}|${price}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          date,
          adult_price: price,
          child_price: null,
          note: 'pdf_spaced_month_day_price',
          status: 'available',
        });
      }
    }
  }

  return rows;
}

function rowsFromLine(line: string, fallbackYear: number, currentMonth: number | null): MatrixPriceRow[] {
  if (EXCLUDED_CONTEXT_RE.test(line)) return [];
  const rows: MatrixPriceRow[] = [];

  const spacedRows = rowsFromSpacedMonthDayPriceLine(line, fallbackYear);
  if (spacedRows.length > 0) return spacedRows;

  const concatenated = splitConcatenatedTail(line);
  if (concatenated) {
    const dates = dateObjectsFromSegment(
      concatenated.dateSegment,
      fallbackYear,
      concatenated.extraMonth ?? currentMonth,
      concatenated.extraBareDay,
    );
    return dates.map(date => ({
      date,
      adult_price: concatenated.price,
      child_price: null,
      note: 'pdf_date_price_table',
      status: 'available',
    }));
  }

  const priceRe = /(\d{1,3}(?:,\d{3})+|\d{5,8})(?:\s*\uC6D0)?/g;
  let previousEnd = 0;
  for (const match of line.matchAll(priceRe)) {
    const price = parsePrice(match[1]);
    if (!price || match.index == null) continue;
    const segment = line.slice(previousEnd, match.index);
    const dates = dateObjectsFromSegment(segment, fallbackYear, currentMonth);
    previousEnd = match.index + match[0].length;
    for (const date of dates) {
      rows.push({
        date,
        adult_price: price,
        child_price: null,
        note: 'pdf_date_price_table',
        status: 'available',
      });
    }
  }

  return rows;
}

export function extractPdfDatePriceRows(
  rawText: string,
  options: PriceIROptions = {},
): MatrixPriceRow[] {
  if (!rawText || rawText.length < 40) return [];
  const fallbackYear = options.year && options.year >= 2000 ? options.year : new Date().getFullYear();
  const rows: MatrixPriceRow[] = [];
  const seen = new Set<string>();
  let currentMonth: number | null = null;

  for (const line of prepareLines(rawText)) {
    const month = monthFromHeader(line);
    if (month && month >= 1 && month <= 12) {
      currentMonth = month;
      continue;
    }
    const extracted = rowsFromLine(line, fallbackYear, currentMonth);
    for (const row of extracted) {
      const key = `${row.date}|${row.adult_price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.adult_price - b.adult_price);
}
