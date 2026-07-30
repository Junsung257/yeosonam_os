export const SOURCE_REGION_OPTIONS = [
  '중국', '필리핀', '베트남', '일본', '말레이시아', '싱가포르', '태국', '라오스', '몽골', '인도네시아', '대만', '홍콩', '마카오',
] as const;

const REGION_RULES: Array<{ region: string; keywords: string[] }> = [
  { region: '중국', keywords: ['중국', 'China', 'Tianjin', '서안', '화산', '병마용', '연길', '백두산', '장가계', '청도', '칭다오', '계림', '광저우', '양삭'] },
  { region: '필리핀', keywords: ['필리핀', '세부', '클락', '보홀', '마닐라'] },
  { region: '베트남', keywords: ['베트남', '푸꾸옥', '다낭', '호이안', '나트랑', '하노이', '하롱', '달랏', '판랑'] },
  { region: '일본', keywords: ['일본', '후쿠오카', '오사카', '나리타', '치바', '도쿄'] },
  { region: '말레이시아', keywords: ['말레이시아', '쿠알라', '말라카', '겐팅'] },
  { region: '싱가포르', keywords: ['싱가포르'] },
  { region: '태국', keywords: ['태국', '방콕', '파타야', '푸켓'] },
  { region: '라오스', keywords: ['라오스', '비엔티안', '비엔티엔', '루앙프라방', '방비엥'] },
  { region: '몽골', keywords: ['몽골', '울란바토르', '테를지'] },
  { region: '인도네시아', keywords: ['인도네시아', '발리'] },
  { region: '대만', keywords: ['대만', '타이베이', '타이페이'] },
  { region: '홍콩', keywords: ['홍콩'] },
  { region: '마카오', keywords: ['마카오'] },
];

const AMBIGUOUS_OPTION_KEYWORDS = ['2층버스', '리버보트', '야시장투어', '크루즈', '마사지', '스카이파크', '스카이 파크'];

export type SourceDriftConfidence = 'source_context' | 'itinerary' | 'needs_review';

export interface SourceDriftPackage {
  id: string;
  internal_code?: string | null;
  title?: string | null;
  destination?: string | null;
  status?: string | null;
  publication_state?: string | null;
  raw_text?: string | null;
  raw_text_hash?: string | null;
  optional_tours?: unknown;
  itinerary_data?: unknown;
}

export interface SourceDriftItem {
  package_id: string;
  internal_code: string | null;
  title: string | null;
  destination: string | null;
  status: string | null;
  publication_state: string | null;
  tour_index: number;
  name: string;
  current_region: string | null;
  suggested_region: string | null;
  confidence: SourceDriftConfidence;
  raw_text_present: boolean;
  raw_text_hash_present: boolean;
  name_found_in_raw_text: boolean;
  normalized_name_match: boolean;
  source_start: number | null;
  source_end: number | null;
  context_excerpt: string | null;
  context_regions: string[];
  itinerary_regions: string[];
}

function regionsFromText(text: string): string[] {
  return [...new Set(REGION_RULES.filter(rule => rule.keywords.some(keyword => text.includes(keyword))).map(rule => rule.region))];
}

function normalizedSource(value: string): { value: string; originalIndexes: number[] } {
  const normalized: string[] = [];
  const originalIndexes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value.slice(index, index + 6).toLowerCase() === '&nbsp;') {
      normalized.push(' ');
      originalIndexes.push(index);
      index += 5;
      continue;
    }
    if (value[index] === '&' && value.slice(index).match(/^&#(?:x[0-9a-f]+|\d+);/i)) {
      const entity = value.slice(index).match(/^&#(?:x[0-9a-f]+|\d+);/i)?.[0] ?? '';
      normalized.push(' ');
      originalIndexes.push(index);
      index += entity.length - 1;
      continue;
    }
    const chunk = value[index].normalize('NFKC').toLowerCase();
    for (const character of chunk) {
      if (/^[\p{Letter}\p{Number}]$/u.test(character)) {
        normalized.push(character);
        originalIndexes.push(index);
      }
    }
  }
  return { value: normalized.join(''), originalIndexes };
}

function findSourceMatch(rawText: string, name: string): { index: number; end: number; normalized: boolean } {
  const exactIndex = rawText.indexOf(name);
  if (exactIndex >= 0) return { index: exactIndex, end: exactIndex + name.length, normalized: false };
  const normalizedName = normalizedSource(name).value;
  if (!normalizedName) return { index: -1, end: -1, normalized: false };
  const normalizedRaw = normalizedSource(rawText);
  const matchIndex = normalizedRaw.value.indexOf(normalizedName);
  if (matchIndex < 0) return { index: -1, end: -1, normalized: false };
  const originalStart = normalizedRaw.originalIndexes[matchIndex];
  const originalEnd = normalizedRaw.originalIndexes[matchIndex + normalizedName.length - 1];
  return { index: originalStart, end: originalEnd + 1, normalized: true };
}

function itineraryRegions(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const days = (value as { days?: unknown }).days;
  if (!Array.isArray(days)) return [];
  const names: string[] = [];
  for (const day of days) {
    if (!day || typeof day !== 'object') continue;
    const row = day as { regions?: unknown; region?: unknown };
    if (Array.isArray(row.regions)) names.push(...row.regions.filter((item): item is string => typeof item === 'string'));
    else if (typeof row.region === 'string') names.push(row.region);
  }
  return [...new Set(names.flatMap(regionsFromText))];
}

export function inspectOptionalTourSource(pkg: SourceDriftPackage): SourceDriftItem[] {
  const tours = Array.isArray(pkg.optional_tours) ? pkg.optional_tours : [];
  const rawText = typeof pkg.raw_text === 'string' ? pkg.raw_text : '';
  const packageItineraryRegions = itineraryRegions(pkg.itinerary_data);

  return tours.flatMap((tour, tourIndex) => {
    if (!tour || typeof tour !== 'object') return [];
    const row = tour as { name?: unknown; region?: unknown };
    const name = typeof row.name === 'string' ? row.name : '';
    const currentRegion = typeof row.region === 'string' && row.region.trim() ? row.region.trim() : null;
    if (!name || currentRegion || !AMBIGUOUS_OPTION_KEYWORDS.some(keyword => name.includes(keyword))) return [];

    const match = findSourceMatch(rawText, name);
    const index = match.index;
    const contextExcerpt = index >= 0
      ? rawText.slice(Math.max(0, index - 180), Math.min(rawText.length, match.end + 180)).replace(/\s+/g, ' ').trim()
      : null;
    const contextRegions = contextExcerpt ? regionsFromText(contextExcerpt) : [];
    const suggestedRegion = contextRegions.length === 1
      ? contextRegions[0]
      : packageItineraryRegions.length === 1 ? packageItineraryRegions[0] : null;
    const confidence: SourceDriftConfidence = contextRegions.length === 1
      ? 'source_context'
      : packageItineraryRegions.length === 1 ? 'itinerary' : 'needs_review';

    return [{
      package_id: pkg.id,
      internal_code: pkg.internal_code ?? null,
      title: pkg.title ?? null,
      destination: pkg.destination ?? null,
      status: pkg.status ?? null,
      publication_state: pkg.publication_state ?? null,
      tour_index: tourIndex,
      name,
      current_region: null,
      suggested_region: suggestedRegion,
      confidence,
      raw_text_present: Boolean(rawText),
      raw_text_hash_present: Boolean(pkg.raw_text_hash),
      name_found_in_raw_text: index >= 0,
      normalized_name_match: match.normalized,
      source_start: index >= 0 ? index : null,
      source_end: match.end >= 0 ? match.end : null,
      context_excerpt: contextExcerpt,
      context_regions: contextRegions,
      itinerary_regions: packageItineraryRegions,
    }];
  });
}

export function isPublicPackage(pkg: Pick<SourceDriftPackage, 'status' | 'publication_state'>): boolean {
  return ['active', 'approved', 'available', 'published'].includes(String(pkg.status ?? '').toLowerCase())
    || String(pkg.publication_state ?? '').toLowerCase() === 'published';
}
