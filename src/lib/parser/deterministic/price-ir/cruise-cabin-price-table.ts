import type { MatrixPriceRow, PriceIROptions } from './types';

const CABIN_LABEL_RE = /^(인사이드|오션뷰|발코니|스위트|내측|해측|창측|발코니\s*스위트)\s+/u;

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractDepartureDate(rawText: string): string | null {
  const koreanRange = rawText.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일[\s\S]{0,40}~\s*(?:(\d{1,2})월\s*)?(\d{1,2})일/u);
  if (koreanRange) {
    return isoDate(Number(koreanRange[1]), Number(koreanRange[2]), Number(koreanRange[3]));
  }

  const iso = rawText.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  return null;
}

function parsePrice(value: string): number | null {
  const price = Number(value.replace(/[^\d]/g, ''));
  if (!Number.isInteger(price) || price < 250_000 || price > 20_000_000) return null;
  return price;
}

export function extractCruiseCabinPriceRows(rawText: string, _options: PriceIROptions = {}): MatrixPriceRow[] {
  if (!/크루즈/.test(rawText)) return [];
  if (!/등\s*급[\s\S]{0,120}1인\s*요금/u.test(rawText) && !/인사이드[\s\S]{0,200}오션뷰[\s\S]{0,200}발코니/u.test(rawText)) {
    return [];
  }

  const date = extractDepartureDate(rawText);
  if (!date) return [];

  const rows: MatrixPriceRow[] = [];
  const seen = new Set<string>();
  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const label = line.match(CABIN_LABEL_RE)?.[1]?.replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const price = parsePrice(line.match(/\d{1,3}(?:,\d{3})+/)?.[0] ?? '');
    if (!price) continue;
    const key = `${date}|${label}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      date,
      adult_price: price,
      child_price: null,
      note: `cruise cabin: ${label}`,
      option_label: label,
      option_type: null,
      status: 'available',
    });
  }

  return rows;
}
