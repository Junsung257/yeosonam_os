export type ProductAnswerIdentityInput = {
  id?: unknown;
  title?: unknown;
  display_title?: unknown;
  destination?: unknown;
  country?: unknown;
  internal_code?: unknown;
  short_code?: unknown;
  duration?: unknown;
  nights?: unknown;
  product_type?: unknown;
  trip_style?: unknown;
  airline?: unknown;
  price?: unknown;
  price_dates?: unknown;
  product_highlights?: unknown;
};

export type ProductAnswerIdentity = {
  key: string;
  label: string;
  baseTitle: string;
  publicCode: string | null;
  internalCode: string | null;
  disambiguators: string[];
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function priceDateRows(value: unknown): Array<{ date?: unknown; price?: unknown }> {
  return Array.isArray(value) ? value as Array<{ date?: unknown; price?: unknown }> : [];
}

function lowestPriceFromDates(value: unknown): number | null {
  const prices = priceDateRows(value)
    .map((row) => numberValue(row.price))
    .filter((price): price is number => price !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

function priceDateRange(value: unknown): string | null {
  const dates = priceDateRows(value)
    .map((row) => text(row.date))
    .filter(Boolean)
    .sort();
  if (dates.length === 0) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? first : `${first}~${last}`;
}

function formatPrice(value: number | null): string | null {
  return value ? `${value.toLocaleString('ko-KR')}원부터` : null;
}

function firstHighlights(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).slice(0, 2)
    : [];
}

function unique(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const clean = text(value);
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

export function buildProductAnswerIdentity(input: ProductAnswerIdentityInput): ProductAnswerIdentity {
  const baseTitle = text(input.display_title) || text(input.title) || 'Untitled product';
  const publicCode = text(input.short_code) || null;
  const internalCode = text(input.internal_code) || null;
  const code = (publicCode ?? internalCode ?? text(input.id)) || null;
  const duration = numberValue(input.duration);
  const nights = numberValue(input.nights);
  const durationText = duration ? `${duration}일${nights ? `/${nights}박` : ''}` : null;
  const lowestPrice = lowestPriceFromDates(input.price_dates) ?? numberValue(input.price);
  const priceText = formatPrice(lowestPrice);
  const dateRange = priceDateRange(input.price_dates);
  const routeText = unique([text(input.country), text(input.destination)]).join(' ');

  const disambiguators = unique([
    code,
    routeText,
    text(input.airline),
    durationText,
    text(input.product_type),
    text(input.trip_style),
    priceText,
    dateRange,
    ...firstHighlights(input.product_highlights),
  ]).slice(0, 8);

  const label = disambiguators.length > 0
    ? `${baseTitle} (${disambiguators.join(' · ')})`
    : baseTitle;
  const keySeed = [
    code,
    normalizeKey(baseTitle),
    normalizeKey(routeText),
    normalizeKey(text(input.airline)),
    durationText,
    normalizeKey(text(input.product_type)),
    normalizeKey(text(input.trip_style)),
    text(input.id),
  ].filter(Boolean).join('|');

  return {
    key: normalizeKey(keySeed || label),
    label,
    baseTitle,
    publicCode,
    internalCode,
    disambiguators,
  };
}
