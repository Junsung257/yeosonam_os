import type { MatrixPriceRow, PriceIROptions } from './types';

const DOW_MAP: Record<string, number> = {
  일: 0,
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
};

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

function parsePrice(value: string): number {
  const match = value.trim().match(/^(\d{1,3}(?:,\d{3})+|\d{5,8}|\d{3,4})/);
  if (!match) return 0;
  const price = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(price) || price <= 0) return 0;
  return price < 10000 ? price * 1000 : price;
}

function parseDurationDays(value: string): number | null {
  const match = value.match(/(\d+)\s*박\s*(\d+)\s*일/);
  return match ? Number(match[2]) : null;
}

function targetDurationDays(options: PriceIROptions): number | null {
  return options.durationDays ?? parseDurationDays(options.title ?? '') ?? null;
}

function slicePriceRegion(rawText: string): string {
  const beforeSection = rawText.split(/\n---\n/)[0] ?? rawText;
  const stop = beforeSection.search(/\n\s*(?:출발날짜|출발인원|포\s*함|불\s*포함|날\s*짜|제\s*1\s*일|DAY\s*1)\s*\n/m);
  return stop > 0 ? beforeSection.slice(0, stop) : beforeSection;
}

export function extractMonthDurationPriceRows(
  rawText: string,
  options: PriceIROptions = {},
): MatrixPriceRow[] {
  if (!rawText || rawText.length < 80) return [];

  const lines = slicePriceRegion(rawText)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const targetDuration = targetDurationDays(options);
  const rows: MatrixPriceRow[] = [];
  const seen = new Set<string>();
  let currentMonth: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const monthMatch = lines[i].match(/^(\d{1,2})월$/);
    if (monthMatch) {
      currentMonth = Number(monthMatch[1]);
      continue;
    }
    if (!currentMonth) continue;

    const dateMatch = lines[i].match(/^\(([일월화수목금토])\)\s*([0-9,\s]+)$/);
    if (!dateMatch) continue;

    const durationDays = parseDurationDays(lines[i + 1] ?? '');
    const price = parsePrice(lines[i + 2] ?? '');
    if (!durationDays || price <= 0) continue;
    if (targetDuration && durationDays !== targetDuration) continue;

    const year = inferYearForMonth(currentMonth, options.year);
    const dow = DOW_MAP[dateMatch[1]];
    const days = dateMatch[2]
      .split(',')
      .map(part => Number(part.trim()))
      .filter(day => Number.isInteger(day) && day > 0);

    for (const day of days) {
      const date = isoDate(year, currentMonth, day);
      if (!date) continue;
      if (dow != null && new Date(`${date}T00:00:00`).getDay() !== dow) continue;
      const key = `${date}|${price}|${durationDays}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        date,
        adult_price: price,
        child_price: null,
        note: `${dateMatch[1]} ${durationDays - 2}박${durationDays}일`,
        status: 'available',
      });
    }
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
