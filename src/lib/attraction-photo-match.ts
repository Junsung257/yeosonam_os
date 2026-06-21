import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { searchPexelsPhotos, isPexelsConfigured, type PexelsPhoto } from '@/lib/pexels';

const UA = 'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) attraction-photo-match';

export interface AttractionPhoto {
  src_medium: string;
  src_large: string;
  photographer: string;
  source: 'pexels' | 'wikimedia';
  pexels_id?: number;
  alt?: string | null;
  query?: string;
  locale?: string | null;
  quality_score?: number;
}

export type AttractionPhotoSearchQuery = {
  query: string;
  locale?: string | null;
  source: 'name' | 'alias' | 'wikidata_label' | 'destination_context';
  priority: number;
};

type WikidataMetadata = {
  labels: string[];
  photos: AttractionPhoto[];
};

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values.map(cleanText).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function knownEnglishAliases(label: string): string[] {
  const compact = label.replace(/\s+/g, '').toLowerCase();
  const pairs: Array<[RegExp, string[]]> = [
    [/\uBC31\uB450\uC0B0\uCC9C\uC9C0|\uBC31\uB450\uC0B0|\uCC9C\uC9C0|paektu|baekdu|tianchi/, ['Changbai Mountain Tianchi', 'Heaven Lake Changbai Mountain', 'Paektu Mountain Heaven Lake']],
    [/\uC7A5\uBC31\uD3ED\uD3EC|\uC545\uD654\uD3ED\uD3EC/, ['Changbai Waterfall', 'Changbaishan Waterfall']],
    [/\uB450\uB9CC\uAC15|tumen/, ['Tumen River China North Korea', 'Tumen River Yanbian']],
    [/\uBE44\uC554\uC0B0|\uC77C\uC1A1\uC815/, ['Biyan Mountain Yanji', 'Yisong Pavilion Longjing China']],
    [/\uD574\uB780\uAC15/, ['Hailan River Yanbian', 'Hailan River Longjing China']],
    [/\uC724\uB3D9\uC8FC\uC0DD\uAC00|\uC724\uB3D9\uC8FC/, ['Yun Dongju Birthplace Longjing China', 'Yoon Dong-ju Birthplace Longjing China']],
    [/\uBA85\uB3D9\uAD50\uD68C/, ['Mingdong Church Longjing China', 'Myeongdong Church Longjing China']],
    [/\uC5F0\uAE38\s*\uBBFC\uC18D\uCD0C|\uC5F0\uAE38\uBBFC\uC18D\uCD0C/, ['Yanji Folk Village', 'Yanbian Korean Folk Village']],
    [/\u0033\u0036\uD638\s*\uACBD\uACC4\uBE44|\u0033\u0037\uD638\s*\uACBD\uACC4\uBE44|\uACBD\uACC4\uBE44/, ['Changbai Mountain border marker', 'China North Korea border marker Changbai Mountain', 'Changbaishan border monument']],
    [/\uC218\uBAA9\uD55C\uACC4\uC120/, ['Changbai Mountain alpine tundra', 'Changbaishan tree line', 'Changbai Mountain treeline']],
    [/\uC2DC\uC548\s*\uC2E4\uD06C\uB85C\uB4DC\uC1FC|\uC11C\uC548\s*\uC2E4\uD06C\uB85C\uB4DC\uC1FC|\uC2E4\uD06C\uB85C\uB4DC\uC1FC|silk\s*road\s*show/, ['Xi An Silk Road Show', 'Xi An Silk Road performance', 'Tang Dynasty show Xian']],
    [/백두산천지|천지|tianchi/, ['Changbai Mountain Tianchi', 'Heaven Lake Changbai Mountain', 'Paektu Mountain Heaven Lake']],
    [/장백폭포/, ['Changbai Waterfall', 'Changbaishan Waterfall']],
    [/금강대협곡/, ['Jinjiang Grand Canyon Changbai Mountain', 'Changbai Mountain Grand Canyon']],
    [/두만강|tumen/, ['Tumen River China North Korea', 'Tumen River Yanbian']],
    [/비암산|일송정/, ['Biyan Mountain Yanji', 'Yisong Pavilion Longjing']],
    [/윤동주|명동교회/, ['Yun Dongju birthplace Longjing', 'Myeongdong Church Longjing China']],
    [/연길민속촌/, ['Yanji Folk Village', 'Yanbian Korean Folk Village']],
    [/노천온천지대/, ['Changbai Mountain hot spring area', 'Changbaishan hot spring']],
    [/니혼다이라|nihondaira/, ['Nihondaira Ropeway', 'Nihondaira Mount Fuji view']],
    [/미호노마츠바라|mihonomatsubara/, ['Miho no Matsubara', 'Miho Matsubara Shizuoka']],
    [/오부치사사바|obuchisasaba/, ['Obuchi Sasaba tea fields', 'Obuchi Sasaba Mount Fuji']],
    [/아라쿠라야마|센겐신사|arakurayama/, ['Arakurayama Sengen Shrine', 'Chureito Pagoda Mount Fuji']],
    [/후지산파노라마로프웨이/, ['Mount Fuji Panoramic Ropeway', 'Kawaguchiko Ropeway']],
    [/오시노핫카이|oshinohakkai/, ['Oshino Hakkai', 'Oshino Hakkai Mount Fuji']],
    [/미시마스카이워크|mishimaskywalk/, ['Mishima Skywalk', 'Mishima Skywalk Mount Fuji']],
  ];
  return pairs.find(([pattern]) => pattern.test(compact))?.[1] ?? [];
}

function isAscii(value: string): boolean {
  return /^[\x20-\x7E]+$/.test(value);
}

export function inferPexelsLocale(input: {
  country?: string | null;
  region?: string | null;
  destination?: string | null;
  label?: string | null;
}): string | null {
  const haystack = [input.country, input.region, input.destination, input.label]
    .map(value => cleanText(value).toLowerCase())
    .join(' ');
  if (/(jp|japan|일본|시즈오카|후지|오사카|도쿄|교토|후쿠오카|벳부|유후인|홋카이도|북해도)/i.test(haystack)) return 'ja-JP';
  if (/(cn|china|중국|연길|백두산|장백|시안|상해|상하이|북경|베이징|청도|장가계)/i.test(haystack)) return 'zh-CN';
  if (/(vn|vietnam|베트남|다낭|나트랑|하노이|호치민|푸꾸옥|달랏)/i.test(haystack)) return 'vi-VN';
  if (/(th|thailand|태국|방콕|치앙마이|푸켓|파타야)/i.test(haystack)) return 'th-TH';
  if (/(tw|taiwan|대만|타이베이|가오슝)/i.test(haystack)) return 'zh-TW';
  if (/(kr|korea|한국|서울|부산|제주|경주)/i.test(haystack)) return 'ko-KR';
  return null;
}

export function buildAttractionPhotoSearchPlan(input: {
  name: string;
  aliases?: string[] | null;
  wikidataLabels?: string[];
  country?: string | null;
  region?: string | null;
  destination?: string | null;
}): AttractionPhotoSearchQuery[] {
  const baseLocale = inferPexelsLocale({
    country: input.country,
    region: input.region,
    destination: input.destination,
    label: input.name,
  });
  const labels = unique([
    input.name,
    ...(input.aliases ?? []),
    ...(input.wikidataLabels ?? []),
  ]);
  const expandedLabels = unique([
    ...labels.flatMap(knownEnglishAliases),
    ...labels,
  ]).sort((a, b) => Number(isAscii(b)) - Number(isAscii(a)));

  const plan: AttractionPhotoSearchQuery[] = [];
  for (const label of expandedLabels) {
    const ascii = isAscii(label);
    const source: AttractionPhotoSearchQuery['source'] =
      input.wikidataLabels?.includes(label) ? 'wikidata_label'
        : input.aliases?.includes(label) ? 'alias'
          : 'name';
    const locale = ascii ? null : baseLocale;
    plan.push({ query: `${label} attraction`, locale, source, priority: source === 'wikidata_label' ? 90 : source === 'alias' ? 80 : 70 });
    plan.push({ query: `${label} landmark`, locale, source, priority: source === 'wikidata_label' ? 86 : source === 'alias' ? 76 : 66 });
  }

  const context = cleanText(input.region ?? input.destination ?? input.country);
  if (context) {
    for (const label of labels.slice(0, 4)) {
      plan.push({
        query: `${context} ${label}`,
        locale: baseLocale,
        source: 'destination_context',
        priority: 55,
      });
    }
  }

  return unique(plan.map(item => `${item.query}|||${item.locale ?? ''}`))
    .map(key => {
      const [query, locale] = key.split('|||');
      return plan.find(item => item.query === query && (item.locale ?? '') === locale) as AttractionPhotoSearchQuery;
    })
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 12);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map(part => part.trim())
    .filter(part => part.length >= 2);
}

function violatesStrictGeoGate(query: string, alt: string): boolean {
  const queryTokens = new Set(tokenize(query));
  const altTokens = new Set(tokenize(alt));
  const hasAny = (tokens: string[]) => tokens.some(token => queryTokens.has(token));
  const altHasAny = (tokens: string[]) => tokens.some(token => altTokens.has(token));

  if (
    hasAny(['longjing', 'yanji', 'yanbian', 'jilin', 'china']) &&
    !altHasAny(['longjing', 'yanji', 'yanbian', 'jilin', 'china'])
  ) {
    return true;
  }

  if (hasAny(['longjing']) && altHasAny(['hangzhou', 'shenzhen', 'suzhou', 'wuhan', 'guizhou', 'seoul', 'korea'])) {
    return true;
  }

  if (
    hasAny(['yoon', 'yun', 'dongju', 'dong', 'birthplace']) &&
    !altHasAny(['yoon', 'yun', 'dongju', 'poet', 'birthplace'])
  ) {
    return true;
  }

  if (
    hasAny(['myeongdong', 'mingdong']) &&
    !altHasAny(['myeongdong', 'mingdong'])
  ) {
    return true;
  }

  if (
    hasAny(['myeongdong', 'mingdong']) &&
    hasAny(['longjing', 'yanbian', 'jilin', 'china']) &&
    altHasAny(['seoul', 'korea'])
  ) {
    return true;
  }

  return false;
}

export function scorePexelsPhoto(input: {
  photo: PexelsPhoto;
  query: AttractionPhotoSearchQuery;
  labels: string[];
}): number {
  const ratio = input.photo.width > 0 && input.photo.height > 0 ? input.photo.width / input.photo.height : 0;
  let score = 0.35;
  if (input.photo.width >= 900 && input.photo.height >= 500) score += 0.18;
  if (ratio >= 1.25 && ratio <= 2.4) score += 0.12;
  if (input.query.source === 'wikidata_label' || input.query.source === 'alias') score += 0.12;
  if (input.query.locale) score += 0.04;

  const altTokens = new Set(tokenize(input.photo.alt || ''));
  const labelTokens = new Set(input.labels.flatMap(tokenize));
  let overlap = 0;
  for (const token of labelTokens) {
    if (altTokens.has(token)) overlap += 1;
  }
  if (overlap > 0) score += Math.min(0.18, overlap * 0.06);
  if (/\?{2,}/.test(input.query.query)) return 0.1;
  if (violatesStrictGeoGate(input.query.query, input.photo.alt || '')) return 0.1;
  const queryIsAscii = isAscii(input.query.query);
  if (queryIsAscii && overlap === 0) return Math.min(score, 0.34);
  if (!queryIsAscii && overlap === 0) return 0.36;

  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

async function fetchWikidataMetadata(qid?: string | null): Promise<WikidataMetadata> {
  if (!qid) return { labels: [], photos: [] };
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=labels|claims&languages=en|ja|zh|ko|vi|th&format=json`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return { labels: [], photos: [] };
    const json = await res.json() as {
      entities?: Record<string, {
        labels?: Record<string, { value?: string }>;
        claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: string } } }>>;
      }>;
    };
    const entity = json.entities?.[qid];
    const labels = unique(Object.values(entity?.labels ?? {}).map(label => label.value ?? ''));
    const photos: AttractionPhoto[] = [];
    const p18Claims = entity?.claims?.P18 ?? [];
    for (const claim of p18Claims) {
      const filename = claim.mainsnak?.datavalue?.value;
      if (!filename) continue;
      photos.push({
        src_medium: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=480`,
        src_large: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=1200`,
        photographer: 'Wikimedia Commons',
        source: 'wikimedia',
        quality_score: 0.98,
      });
    }
    return { labels, photos: photos.slice(0, 5) };
  } catch {
    return { labels: [], photos: [] };
  }
}

async function searchPexelsForAttraction(input: {
  plan: AttractionPhotoSearchQuery[];
  labels: string[];
  count: number;
}): Promise<AttractionPhoto[]> {
  if (!isPexelsConfigured()) return [];
  const results: AttractionPhoto[] = [];
  const seen = new Set<string>();

  for (const query of input.plan) {
    if (results.length >= input.count) break;
    try {
      const photos = await searchPexelsPhotos(query.query, 5, 1, {
        orientation: 'landscape',
        locale: query.locale ?? undefined,
      });
      const scored = photos
        .map(photo => ({ photo, score: scorePexelsPhoto({ photo, query, labels: input.labels }) }))
        .filter(item => item.score >= 0.45)
        .sort((a, b) => b.score - a.score);
      for (const item of scored) {
        if (seen.has(item.photo.url)) continue;
        seen.add(item.photo.url);
        results.push({
          src_medium: item.photo.src.medium,
          src_large: item.photo.src.large2x || item.photo.src.large,
          photographer: item.photo.photographer,
          source: 'pexels',
          pexels_id: item.photo.id,
          alt: item.photo.alt,
          query: query.query,
          locale: query.locale ?? null,
          quality_score: item.score,
        });
        if (results.length >= input.count) break;
      }
    } catch {
      continue;
    }
  }

  return results.sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0)).slice(0, input.count);
}

function mergePhotos(input: AttractionPhoto[], maxPhotos: number): AttractionPhoto[] {
  const seen = new Set<string>();
  const merged: AttractionPhoto[] = [];
  for (const photo of input) {
    const key = photo.pexels_id ? `pexels:${photo.pexels_id}` : photo.src_large || photo.src_medium;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(photo);
    if (merged.length >= maxPhotos) break;
  }
  return merged;
}

export async function runAttractionPhotoMatch(
  attractionId: string,
  options: {
    keywords: string[];
    qid?: string | null;
    maxPhotos?: number;
    country?: string | null;
    region?: string | null;
    destination?: string | null;
    replaceExisting?: boolean | 'if_low_quality';
  },
): Promise<AttractionPhoto[]> {
  if (!isSupabaseConfigured) return [];
  const maxPhotos = options.maxPhotos ?? 5;
  const name = cleanText(options.keywords[0]);
  if (!name) return [];

  const wikidata = await fetchWikidataMetadata(options.qid);
  const aliases = options.keywords.slice(1);
  const labels = unique([name, ...aliases, ...wikidata.labels]);
  const plan = buildAttractionPhotoSearchPlan({
    name,
    aliases,
    wikidataLabels: wikidata.labels,
    country: options.country,
    region: options.region,
    destination: options.destination,
  });

  const pexels = await searchPexelsForAttraction({
    plan,
    labels,
    count: Math.max(0, maxPhotos - wikidata.photos.length),
  });
  const merged = mergePhotos([...wikidata.photos, ...pexels], maxPhotos);
  if (merged.length === 0) return [];

  const { data: existing } = await supabaseAdmin
    .from('attractions')
    .select('photos')
    .eq('id', attractionId)
    .maybeSingle();

  const existingPhotos = (existing as { photos?: AttractionPhoto[] } | null)?.photos ?? [];
  const existingTopScore = Array.isArray(existingPhotos)
    ? Math.max(0, ...existingPhotos.map(photo => {
      const alt = cleanText(photo.alt);
      if (!alt) return 0.25;
      const altTokens = new Set(tokenize(alt));
      const labelTokens = new Set(labels.flatMap(tokenize));
      let overlap = 0;
      for (const token of labelTokens) {
        if (altTokens.has(token)) overlap += 1;
      }
      return Math.min(0.8, 0.3 + overlap * 0.12);
    }))
    : 0;
  const newTopScore = Math.max(0, ...merged.map(photo => photo.quality_score ?? 0.5));
  const shouldUpdate =
    !Array.isArray(existingPhotos) ||
    existingPhotos.length === 0 ||
    options.replaceExisting === true ||
    (options.replaceExisting === 'if_low_quality' && (existingTopScore < 0.5 || newTopScore > existingTopScore + 0.12));

  if (shouldUpdate) {
    await supabaseAdmin
      .from('attractions')
      .update({
        photos: merged,
        updated_at: new Date().toISOString(),
      })
      .eq('id', attractionId);
  }

  return merged;
}

export async function batchAttractionPhotoMatch(
  limit = 50,
): Promise<{ processed: number; totalPhotos: number }> {
  if (!isSupabaseConfigured) return { processed: 0, totalPhotos: 0 };

  const fetchRows = (select: string) => (supabaseAdmin.from('attractions') as any)
    .select(select)
    .eq('is_active', true)
    .or('photos.is.null,photos.eq."[]"')
    .limit(limit);

  let { data: rows, error } = await fetchRows('id, name, aliases, qid, country, region');

  if (error && /qid/i.test(error.message ?? '')) {
    const retry = await fetchRows('id, name, aliases, country, region');
    rows = Array.isArray(retry.data)
      ? retry.data.map((row: Record<string, unknown>) => ({ ...row, qid: null }))
      : null;
    error = retry.error;
  }

  if (error || !rows) {
    console.warn('[AttractionPhoto] batch fetch failed:', error?.message);
    return { processed: 0, totalPhotos: 0 };
  }

  let totalPhotos = 0;
  for (const row of rows as unknown as Array<{
    id: string;
    name: string;
    aliases: string[] | null;
    qid?: string | null;
    country: string | null;
    region: string | null;
  }>) {
    const keywords = unique([row.name, ...(row.aliases ?? [])]);
    const photos = await runAttractionPhotoMatch(row.id, {
      keywords,
      qid: row.qid ?? null,
      country: row.country,
      region: row.region,
      destination: row.region,
      maxPhotos: 5,
    });
    totalPhotos += photos.length;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return { processed: rows.length, totalPhotos };
}
