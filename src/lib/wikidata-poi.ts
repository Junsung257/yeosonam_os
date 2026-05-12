/**
 * @file wikidata-poi.ts — Wikidata POI 검색/조회 (무료, CC 라이선스, 영구 저장 OK)
 *
 * 왜 Wikidata?
 *   - CC0/CC-BY-SA → DB 영구 저장 가능 (vs Google Places 30일 캐싱 한도)
 *   - 다국어 라벨 (ko/en/ja/zh 모두 한 entity 에서)
 *   - GPS (P625), 사진 (P18 → Wikimedia Commons), 카테고리 (P31 instance of)
 *   - 무료 + rate limit 관대 (등록 봇 1회/초)
 *   - QID 가 절대 안정적 ID (place_id 와 달리 영구)
 *
 * 우리 사용:
 *   1. attractions 마스터 보강 (다국어 alias 자동 흡수)
 *   2. unmatched suggest 에 Wikidata 후보 추가
 *   3. AI 환각 방지 ground truth (Q ID 기반 사실 검증)
 *
 * API: https://www.wikidata.org/w/api.php (action=wbsearchentities + wbgetentities)
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const SPARQL_API = 'https://query.wikidata.org/sparql';

const COMMON_HEADERS = {
  'User-Agent': 'YeosonamOS/1.0 (https://yeosonam.com; contact@yeosonam.com)',
  'Accept': 'application/json',
};

export interface WikidataPoi {
  qid: string;                 // 'Q12345'
  label_ko: string | null;
  label_en: string | null;
  label_local: string | null;
  description_ko: string | null;
  description_en: string | null;
  aliases_ko: string[];
  aliases_en: string[];
  coordinates: { lat: number; lng: number } | null;
  image_filename: string | null;       // 'Foo.jpg' (Wikimedia Commons)
  image_url: string | null;
  instance_of: string[];               // 카테고리 QID 리스트 (관광지/사원/박물관 등)
  country_qid: string | null;
  url: string;                          // wikidata.org/wiki/Qxxx
}

// ═══════════════════════════════════════════════════════════════════════════
//  검색 — 자유 텍스트 → 후보 QID 리스트
// ═══════════════════════════════════════════════════════════════════════════
export async function searchWikidata(
  query: string,
  options: { language?: 'ko' | 'en' | 'ja' | 'zh'; limit?: number } = {},
): Promise<Array<{ qid: string; label: string; description: string | null }>> {
  const { language = 'ko', limit = 10 } = options;
  if (!query || query.length < 2) return [];

  const url = new URL(WIKIDATA_API);
  url.searchParams.set('action', 'wbsearchentities');
  url.searchParams.set('search', query);
  url.searchParams.set('language', language);
  url.searchParams.set('uselang', language);
  url.searchParams.set('limit', String(Math.min(50, Math.max(1, limit))));
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  try {
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.search || []).map((r: { id: string; label: string; description?: string }) => ({
      qid: r.id,
      label: r.label,
      description: r.description || null,
    }));
  } catch (e) {
    console.warn('[wikidata-poi search] 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  단일 QID 상세 조회 — 다국어 라벨/GPS/이미지/카테고리
// ═══════════════════════════════════════════════════════════════════════════
export async function getWikidataPoi(qid: string): Promise<WikidataPoi | null> {
  if (!/^Q\d+$/.test(qid)) return null;

  const url = new URL(WIKIDATA_API);
  url.searchParams.set('action', 'wbgetentities');
  url.searchParams.set('ids', qid);
  url.searchParams.set('props', 'labels|descriptions|aliases|claims');
  url.searchParams.set('languages', 'ko|en|ja|zh');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  try {
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    const ent = json.entities?.[qid];
    if (!ent) return null;

    const labelKo = ent.labels?.ko?.value ?? null;
    const labelEn = ent.labels?.en?.value ?? null;
    const labelLocal = ent.labels?.ja?.value || ent.labels?.zh?.value || null;
    const descKo = ent.descriptions?.ko?.value ?? null;
    const descEn = ent.descriptions?.en?.value ?? null;
    const aliasesKo = (ent.aliases?.ko || []).map((a: { value: string }) => a.value);
    const aliasesEn = (ent.aliases?.en || []).map((a: { value: string }) => a.value);

    // P625 (좌표)
    let coordinates: { lat: number; lng: number } | null = null;
    const coordClaim = ent.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    if (coordClaim?.latitude != null && coordClaim?.longitude != null) {
      coordinates = { lat: coordClaim.latitude, lng: coordClaim.longitude };
    }

    // P18 (이미지)
    const imageFilename = ent.claims?.P18?.[0]?.mainsnak?.datavalue?.value || null;
    const imageUrl = imageFilename
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageFilename)}?width=1200`
      : null;

    // P31 (instance of) — 카테고리 QID 리스트
    const instanceOf = (ent.claims?.P31 || [])
      .map((c: { mainsnak?: { datavalue?: { value?: { id?: string } } } }) => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean) as string[];

    // P17 (country)
    const countryQid = ent.claims?.P17?.[0]?.mainsnak?.datavalue?.value?.id || null;

    return {
      qid,
      label_ko: labelKo,
      label_en: labelEn,
      label_local: labelLocal,
      description_ko: descKo,
      description_en: descEn,
      aliases_ko: aliasesKo,
      aliases_en: aliasesEn,
      coordinates,
      image_filename: imageFilename,
      image_url: imageUrl,
      instance_of: instanceOf,
      country_qid: countryQid,
      url: `https://www.wikidata.org/wiki/${qid}`,
    };
  } catch (e) {
    console.warn('[wikidata-poi get] 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  지역 + 카테고리 필터 검색 (SPARQL) — 정확도 ↑
//  예: "보홀" + 관광지(Q570116) → Bohol 안의 관광지 QID 리스트
// ═══════════════════════════════════════════════════════════════════════════
export async function searchPoisInRegion(
  regionQid: string,
  options: { categoryQids?: string[]; limit?: number } = {},
): Promise<Array<{ qid: string; label_ko: string | null; label_en: string | null; coords: { lat: number; lng: number } | null }>> {
  const { categoryQids = ['Q570116', 'Q33506', 'Q4989906', 'Q23397'], limit = 50 } = options;
  // Q570116 tourist attraction / Q33506 museum / Q4989906 monument / Q23397 lake (예시)

  if (!/^Q\d+$/.test(regionQid)) return [];

  const categoryFilter = categoryQids
    .filter(q => /^Q\d+$/.test(q))
    .map(q => `wd:${q}`)
    .join(' ');

  const sparql = `
    SELECT ?item ?itemLabel_ko ?itemLabel_en ?coord WHERE {
      ?item wdt:P131* wd:${regionQid} .
      VALUES ?cat { ${categoryFilter} }
      ?item wdt:P31/wdt:P279* ?cat .
      OPTIONAL { ?item wdt:P625 ?coord }
      OPTIONAL { ?item rdfs:label ?itemLabel_ko FILTER(LANG(?itemLabel_ko) = "ko") }
      OPTIONAL { ?item rdfs:label ?itemLabel_en FILTER(LANG(?itemLabel_en) = "en") }
    }
    LIMIT ${Math.min(200, Math.max(1, limit))}
  `;

  try {
    const url = `${SPARQL_API}?query=${encodeURIComponent(sparql)}&format=json`;
    const res = await fetch(url, { headers: COMMON_HEADERS });
    if (!res.ok) return [];
    const json = await res.json();
    const bindings = json?.results?.bindings || [];

    return bindings.map((b: {
      item: { value: string };
      itemLabel_ko?: { value: string };
      itemLabel_en?: { value: string };
      coord?: { value: string };
    }) => {
      const qid = b.item.value.split('/').pop() || '';
      let coords: { lat: number; lng: number } | null = null;
      if (b.coord?.value) {
        // "Point(lng lat)" 형식
        const m = b.coord.value.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
        if (m) coords = { lat: Number(m[2]), lng: Number(m[1]) };
      }
      return {
        qid,
        label_ko: b.itemLabel_ko?.value || null,
        label_en: b.itemLabel_en?.value || null,
        coords,
      };
    });
  } catch (e) {
    console.warn('[wikidata-poi searchPoisInRegion] 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helper: WikidataPoi → attractions 테이블 INSERT 페이로드
// ═══════════════════════════════════════════════════════════════════════════
export function poiToAttractionPayload(poi: WikidataPoi, options: { region?: string; country?: string; category?: string } = {}): {
  name: string;
  short_desc: string | null;
  long_desc: string | null;
  country: string | null;
  region: string | null;
  category: string | null;
  aliases: string[];
  emoji: string | null;
} {
  const name = poi.label_ko || poi.label_en || poi.label_local || poi.qid;
  const aliases = [
    poi.label_en,
    poi.label_local,
    ...(poi.aliases_ko || []),
    ...(poi.aliases_en || []),
  ].filter((v): v is string => !!v && v !== name);

  return {
    name,
    short_desc: poi.description_ko || poi.description_en || null,
    long_desc: null, // long_desc 는 사장님이 직접 등록 (자동 생성 금지 정책)
    country: options.country || null,
    region: options.region || null,
    category: options.category || (poi.instance_of[0] === 'Q33506' ? 'museum' : 'sightseeing'),
    aliases: [...new Set(aliases)],
    emoji: null,
  };
}
