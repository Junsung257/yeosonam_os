import type { MatrixPriceRow, PriceIROptions } from './types';

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

function parseKrwPrice(line: string): number {
  const text = line.replace(/\s+/g, '');
  const match = text.match(/^(\d{1,3}(?:,\d{3})+|\d{5,8}|\d{3,4})(?:원|,-)?$/);
  if (!match) return 0;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 10000 ? value * 1000 : value;
}

function parseDateListLine(line: string, yearHint?: number): string[] {
  const compact = line
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  if (!/\d{1,2}[./]\d{1,2}/.test(compact)) return [];
  if (/[가-힣A-Za-z]/.test(compact.replace(/월|일|출발|확정|가능|최저가/g, ''))) return [];

  const normalized = compact.replace(/[.]/g, '/').replace(/월/g, '/').replace(/일/g, '');
  const tokens = normalized.split(/[,，、|]+/).map(token => token.trim()).filter(Boolean);
  const dates: string[] = [];
  let month: number | null = null;

  for (const token of tokens) {
    const explicit = token.match(/^(\d{1,2})[./](\d{1,2})$/);
    if (explicit) {
      month = Number(explicit[1]);
      const iso = isoDate(inferYearForMonth(month, yearHint), month, Number(explicit[2]));
      if (iso) dates.push(iso);
      continue;
    }

    const dayOnly = token.match(/^\d{1,2}$/);
    if (dayOnly && month != null) {
      const iso = isoDate(inferYearForMonth(month, yearHint), month, Number(token));
      if (iso) dates.push(iso);
    }
  }

  return [...new Set(dates)];
}

function sliceProductPriceSection(rawText: string): string {
  const startMatch = rawText.match(/^\s*(?:상품\s*가|판매\s*가|요금\s*표|출발\s*일\s*(?:&|및)?\s*상품\s*가|출발\s*일자|출발\s*날짜)\s*$/m);
  if (!startMatch?.index && startMatch?.index !== 0) return '';

  const start = startMatch.index;
  const tail = rawText.slice(start);
  const stop = tail.search(/^\s*(?:포\s*함\s*(?:내역|사항)|불\s*포함|일정표?|여행\s*일정|일\s*시|1\s*일|DAY\s*1|취소|예약|호텔|항공|비\s*고|쇼핑|옵션)\b/m);
  return stop > 0 ? tail.slice(0, stop) : tail;
}

export function extractProductPriceVerticalDateRows(
  rawText: string,
  options: PriceIROptions = {},
): MatrixPriceRow[] {
  const section = sliceProductPriceSection(rawText);
  if (!section) return [];

  const lines = section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const rows: MatrixPriceRow[] = [];
  const byDate = new Map<string, MatrixPriceRow>();

  for (let i = 0; i < lines.length; i++) {
    const dates = parseDateListLine(lines[i], options.year);
    if (dates.length === 0) continue;

    let price = 0;
    let priceIndex = i + 1;
    for (; priceIndex < Math.min(lines.length, i + 5); priceIndex++) {
      price = parseKrwPrice(lines[priceIndex]);
      if (price > 0) break;
      if (parseDateListLine(lines[priceIndex], options.year).length > 0) break;
    }
    if (price <= 0) continue;

    for (const date of dates) {
      byDate.set(date, {
        date,
        adult_price: price,
        child_price: null,
        note: '상품가',
        status: 'available',
      });
    }
    i = priceIndex;
  }

  rows.push(...byDate.values());
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
