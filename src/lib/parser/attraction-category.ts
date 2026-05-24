/**
 * @file attraction-category.ts — 활동명/Wikidata type 기반 관광지 카테고리 추론
 */

/** 관광지 type → category 매핑 (Wikidata Q31 instance of) */
const TYPE_CATEGORY_MAP: Record<string, string> = {
  Q570: 'landmark',      // tourist attraction
  Q2344606: 'nature',    // park
  Q16560: 'culture',     // heritage site
  Q41176: 'landmark',    // building
  Q33506: 'culture',     // museum
  Q2439834: 'fun',       // amusement park
  Q839237: 'fun',        // theme park
  Q274153: 'culture',    // ancient city
  Q176353: 'culture',    // palace
  Q298: 'culture',       // theatre
  Q108551: 'culture',    // historic district
  Q9259: 'nature',       // botanical garden
  Q1093841: 'culture',   // temple
  Q947432: 'culture',    // shrine
  Q16970: 'culture',     // church
  Q811534: 'nature',     // beach
  Q47521: 'landmark',    // square
  Q16917: 'landmark',    // street
  Q214506: 'nature',     // waterfall
  Q23397: 'nature',      // mountain
  Q172296: 'nature',     // lake
  Q46851: 'nature',      // cave
};

/** 한글 키워드 기반 category 추론 fallback */
const KEYWORD_CATEGORY: [RegExp, string][] = [
  [/공원|파크|자연|폭포|해변|비치|산|호수|동굴|계곡|섬|정원/iu, 'nature'],
  [/박물관|뮤지엄|갤러리|전시|유적|사원|절|신사|성당|교회|궁전|성|문화/iu, 'culture'],
  [/놀이|테마|어드벤처|워터|케이블|전망대/iu, 'fun'],
  [/시장|거리|마을|쇼핑|타운|빌리지/iu, 'shopping'],
  [/랜드마크|타워|교량|다리|광장|건축/iu, 'landmark'],
];

/**
 * 활동명과 Wikidata type에서 category 추론.
 * Wikidata type이 매핑에 있으면 그것을 우선, 없으면 키워드 기반 fallback.
 */
export function inferCategory(
  name: string | null | undefined,
  typeQid?: string,
): string {
  if (typeQid && TYPE_CATEGORY_MAP[typeQid]) {
    return TYPE_CATEGORY_MAP[typeQid];
  }
  if (!name) return 'landmark';
  for (const [re, cat] of KEYWORD_CATEGORY) {
    if (re.test(name)) return cat;
  }
  return 'landmark';
}
