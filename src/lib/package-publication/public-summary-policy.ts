type AnyRecord = Record<string, unknown>;

type SummaryInput = {
  publicTitle: string;
  pkg: AnyRecord;
  optionBadges?: string[] | null;
  optionalTourStatus?: string | null;
};

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hasArrayItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasPriceEvidence(pkg: AnyRecord): boolean {
  if (asNumber(pkg.price)) return true;
  if (hasArrayItems(pkg.product_prices) || hasArrayItems(pkg.price_dates)) return true;
  return false;
}

function hasItineraryEvidence(pkg: AnyRecord): boolean {
  const itinerary = pkg.itinerary_data;
  if (!itinerary || typeof itinerary !== 'object') return false;
  const days = (itinerary as AnyRecord).days;
  return Array.isArray(days) && days.length > 0;
}

function hasFlightEvidence(pkg: AnyRecord): boolean {
  return Boolean(pkg.airline)
    || JSON.stringify(pkg.itinerary_data ?? '').match(/flight_no|dep_time|arr_time|항공|공항|출발|도착/i) !== null;
}

function cleanBadge(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (/(출발\s*확정|즉시\s*확정|좌석\s*확보|최저가\s*보장|스팟\s*특가|마감\s*임박)/.test(text)) return null;
  return text;
}

function conditionPhrase(input: SummaryInput): string | null {
  const badges = (input.optionBadges ?? []).map(cleanBadge).filter((value): value is string => Boolean(value));
  if (/노팁·노옵션|노팁\s*\/\s*노옵션|노팁\s+노옵션/.test(input.publicTitle)) {
    return '노팁·노옵션 조건';
  }
  if (badges.length > 0) return `${badges.slice(0, 2).join('·')} 조건`;
  if (input.optionalTourStatus === 'none_explicit') return '노옵션 조건';
  return null;
}

function evidencePhrase(pkg: AnyRecord): string {
  const items: string[] = [];
  if (hasItineraryEvidence(pkg)) items.push('일정');
  if (hasPriceEvidence(pkg)) items.push('가격');
  if (hasFlightEvidence(pkg)) items.push('항공');
  if (hasArrayItems(pkg.inclusions)) items.push('포함 사항');
  if (items.length === 0) return '일정과 포함 조건';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join('·')}·${items[items.length - 1]}`;
}

function naturalTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

export function composeCustomerPublicSummary(input: SummaryInput): string {
  const title = naturalTitle(input.publicTitle);
  if (!title) return '';

  const condition = conditionPhrase(input);
  const evidence = evidencePhrase(input.pkg);
  const conditionLead = condition ? `${condition}과 ` : '';
  return `${title} 상품입니다. ${conditionLead}${evidence}을 상담 전에 한눈에 확인할 수 있어요.`;
}

export function composeCustomerPublicSubtitle(input: SummaryInput): string {
  const condition = conditionPhrase(input);
  const evidence = evidencePhrase(input.pkg);
  if (condition) return `${condition} · ${evidence} 확인`;
  return `${evidence} 확인`;
}
