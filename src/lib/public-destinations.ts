export interface ActiveDestinationLike {
  destination: string | null;
  package_count?: number | string | null;
  avg_rating?: number | string | null;
  total_reviews?: number | string | null;
  min_price?: number | string | null;
}

export interface PublicDestinationStat {
  destination: string;
  package_count: number;
  avg_rating: number | null;
  total_reviews: number;
  min_price: number | null;
  raw_destinations: string[];
}

const EXACT_PUBLIC_DESTINATION_MAP: Record<string, string | null> = {
  '부산-계림 실속': '계림',
  '부산-계림 품격': '계림',
  '북해도 스팟특가 4일': '북해도',
  '북해도 실속비에이': '북해도',
  '북해도 품격팩': '북해도',
  '북해도 핵심알짜팩': '북해도',
  '북해도 알짜팩': '북해도',
  '청도 2색골프': '청도',
  '노팁/노옵션 특급호텔 청도+맥주박물관': '청도',
  '서안/화산': '서안',
  '서안-화산': '서안',
  '광저우/천저우': '광저우',
  '광저우-천저우': '광저우',
  '호이안/바나힐': '다낭',
  '호이안-바나힐': '다낭',
  '다낭/호이안': '다낭',
  '다낭-호이안': '다낭',
  '나트랑/달랏': '나트랑',
  '나트랑-달랏': '나트랑',
  '방콕 & 파타야': '방콕',
  '방콕-&-파타야': '방콕',
  '방콕/파타야': '방콕',
  '하노이/하롱베이/옌뜨': '하노이',
  '하노이-하롱베이-옌뜨': '하노이',
  '하노이/옌뜨/하롱베이': '하노이',
  '하노이-옌뜨-하롱베이': '하노이',
  '하노이/하롱/옌뜨': '하노이',
  '하노이-하롱-옌뜨': '하노이',
  '하노이/하롱베이': '하노이',
  '하노이-하롱베이': '하노이',
  '하노이/사파': '하노이',
  '하노이-사파': '하노이',
  '하노이/메가월드/하롱베이/디너크루즈': '하노이',
  '하노이-메가월드-하롱베이-디너크루즈': '하노이',
  '시즈오카/아타미/이즈/하코네/카와구치': '시즈오카',
  '시즈오카-아타미-이즈-하코네-카와구치': '시즈오카',
  '시즈오카/카와구치': '시즈오카',
  '시즈오카-카와구치': '시즈오카',
  '시즈오카/카와구치/도쿄': '시즈오카',
  '시즈오카-카와구치-도쿄': '시즈오카',
  '울란바토르/테를지': '몽골',
  '울란바토르-테를지': '몽골',
};

const PRODUCT_DESTINATION_PATTERNS = [
  /스팟\s*특가/i,
  /특가/i,
  /품격\s*팩/i,
  /실속\s*비에이/i,
  /핵심\s*알짜\s*팩/i,
  /알짜\s*팩/i,
  /노팁/i,
  /노옵션/i,
  /특급\s*호텔/i,
  /맥주\s*박물관/i,
  /\d+\s*색\s*골프/i,
  /\d+\s*일$/,
];

const PUBLIC_DESTINATION_ALIASES: Record<string, string[]> = {};

for (const [alias, canonical] of Object.entries(EXACT_PUBLIC_DESTINATION_MAP)) {
  if (!canonical) continue;
  PUBLIC_DESTINATION_ALIASES[canonical] = [...(PUBLIC_DESTINATION_ALIASES[canonical] ?? []), alias];
}

const ADDITIONAL_ALIASES: Record<string, string[]> = {
  '연길/백두산': ['연길', '연길-백두산'],
  북해도: ['홋카이도', '삿포로', '북해도'],
  계림: ['부산-계림 실속', '부산-계림 품격', '계림'],
  청도: ['청도 2색골프', '노팁/노옵션 특급호텔 청도+맥주박물관', '청도'],
  다낭: ['다낭/호이안', '다낭-호이안', '호이안/바나힐', '호이안-바나힐', '다낭'],
  나트랑: ['나트랑/달랏', '나트랑-달랏', '나트랑'],
  방콕: ['방콕 & 파타야', '방콕-&-파타야', '방콕/파타야', '방콕'],
  하노이: [
    '하노이/하롱베이/옌뜨',
    '하노이/옌뜨/하롱베이',
    '하노이/하롱/옌뜨',
    '하노이/하롱베이',
    '하노이/사파',
    '하노이/메가월드/하롱베이/디너크루즈',
    '하노이',
  ],
  시즈오카: [
    '시즈오카/아타미/이즈/하코네/카와구치',
    '시즈오카/카와구치',
    '시즈오카/카와구치/도쿄',
    '시즈오카',
  ],
  몽골: ['울란바토르/테를지', '몽골'],
};

for (const [canonical, aliases] of Object.entries(ADDITIONAL_ALIASES)) {
  PUBLIC_DESTINATION_ALIASES[canonical] = [...(PUBLIC_DESTINATION_ALIASES[canonical] ?? []), ...aliases];
}

function cleanDestination(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*&\s*/g, ' & ')
    .trim();
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toSlug(value: string): string {
  return cleanDestination(value)
    .replace(/[\/\\→+]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function canonicalizePublicDestination(value: string | null | undefined): string | null {
  const cleaned = cleanDestination(value);
  if (!cleaned) return null;

  const exact = EXACT_PUBLIC_DESTINATION_MAP[cleaned];
  if (exact !== undefined) return exact;

  if (/^부산-계림/.test(cleaned)) return '계림';
  if (/북해도/.test(cleaned) && PRODUCT_DESTINATION_PATTERNS.some((pattern) => pattern.test(cleaned))) return '북해도';
  if (/청도/.test(cleaned) && PRODUCT_DESTINATION_PATTERNS.some((pattern) => pattern.test(cleaned))) return '청도';
  if (/하노이/.test(cleaned) && /\/|-/.test(cleaned)) return '하노이';
  if (/시즈오카/.test(cleaned) && /\/|-/.test(cleaned)) return '시즈오카';

  return cleaned;
}

export function isProductLikeDestination(value: string | null | undefined): boolean {
  const cleaned = cleanDestination(value);
  if (!cleaned) return false;
  const canonical = canonicalizePublicDestination(cleaned);
  return Boolean(canonical && canonical !== cleaned) || PRODUCT_DESTINATION_PATTERNS.some((pattern) => pattern.test(cleaned));
}

export function getPublicDestinationQueryNames(destination: string): string[] {
  const canonical = canonicalizePublicDestination(destination) ?? cleanDestination(destination);
  const aliases = PUBLIC_DESTINATION_ALIASES[canonical] ?? [];
  return [...new Set([canonical, destination, ...aliases].map(cleanDestination).filter(Boolean))];
}

export function slugMatchesPublicDestination(destination: string, slugOrDestination: string): boolean {
  const canonical = canonicalizePublicDestination(destination);
  if (!canonical) return false;
  const normalized = cleanDestination(slugOrDestination);
  return canonical === normalized || toSlug(canonical) === toSlug(normalized) || getPublicDestinationQueryNames(canonical).some((alias) => alias === normalized || toSlug(alias) === toSlug(normalized));
}

export function mergePublicDestinationStats(rows: ActiveDestinationLike[]): PublicDestinationStat[] {
  const byDestination = new Map<string, PublicDestinationStat & { ratingWeightedTotal: number; ratingWeight: number }>();

  for (const row of rows) {
    const raw = cleanDestination(row.destination);
    const canonical = canonicalizePublicDestination(raw);
    if (!raw || !canonical) continue;

    const packageCount = Math.max(0, Math.trunc(toNumber(row.package_count) ?? 0));
    const reviewCount = Math.max(0, Math.trunc(toNumber(row.total_reviews) ?? 0));
    const avgRating = toNumber(row.avg_rating);
    const minPrice = toNumber(row.min_price);
    const ratingWeight = reviewCount || packageCount || 1;

    const existing = byDestination.get(canonical);
    if (!existing) {
      byDestination.set(canonical, {
        destination: canonical,
        package_count: packageCount,
        avg_rating: avgRating,
        total_reviews: reviewCount,
        min_price: minPrice && minPrice > 0 ? minPrice : null,
        raw_destinations: [raw],
        ratingWeightedTotal: avgRating ? avgRating * ratingWeight : 0,
        ratingWeight: avgRating ? ratingWeight : 0,
      });
      continue;
    }

    existing.package_count += packageCount;
    existing.total_reviews += reviewCount;
    if (minPrice && minPrice > 0) existing.min_price = existing.min_price == null ? minPrice : Math.min(existing.min_price, minPrice);
    if (!existing.raw_destinations.includes(raw)) existing.raw_destinations.push(raw);
    if (avgRating) {
      existing.ratingWeightedTotal += avgRating * ratingWeight;
      existing.ratingWeight += ratingWeight;
    }
  }

  return [...byDestination.values()]
    .map(({ ratingWeightedTotal, ratingWeight, ...stat }) => ({
      ...stat,
      avg_rating: ratingWeight > 0 ? ratingWeightedTotal / ratingWeight : null,
    }))
    .sort((a, b) => b.package_count - a.package_count || a.destination.localeCompare(b.destination, 'ko'));
}

