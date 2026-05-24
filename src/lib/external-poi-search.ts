/**
 * @file external-poi-search.ts — 무료 외부 POI 소스 검색 (Overpass API + Wikidata)
 *
 * 내부 DB 매칭 실패 시 2차/3차 검색으로 외부 POI 데이터를 찾는다.
 * STRICT SSOT: 자동 INSERT 절대 금지, note 컬럼에 JSON 로그만 저장.
 *
 * 검색 순서:
 *   1) Overpass API (OpenStreetMap) — 한국 관광지 name 일치 검색, 무료, 키 불필요
 *   2) Wikidata API — wbsearchentities + wbgetentities, 무료, 키 불필요
 *
 * Rate limit:
 *   Overpass: 호출 간격 최소 1초 (공용 서버 보호)
 *   Wikidata: 공식 limit 없으나 User-Agent 명시, 짧은 간격 허용
 */

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) external-poi-search';
const OVERPASS_MIN_INTERVAL_MS = 1000; // Overpass 공용 서버 부하 방지

let lastOverpassCall = 0;

/** Overpass 검색 결과 */
export interface OverpassPOI {
  source: 'overpass';
  name: string;
  nameKo: string | null;
  type: 'node' | 'way' | 'relation';
  lat: number | null;
  lon: number | null;
  tourism: string | null;
  historic: string | null;
  description: string | null;
  /** OSM element URL */
  osmUrl: string;
}

/** Wikidata 검색 결과 (suggestFromWikidata 호환) */
export interface WikidataPOI {
  source: 'wikidata';
  qid: string;
  labelKo: string | null;
  labelEn: string | null;
  description: string | null;
  imageThumbUrl: string | null;
}

/** 통합 외부 POI 검색 결과 */
export interface ExternalPOISearchResult {
  /** 내부 DB 매칭 score 근사값 */
  confidence: number;
  source: 'overpass' | 'wikidata';
  displayName: string;
  raw: OverpassPOI | WikidataPOI;
}

/**
 * Overpass API로 한국 관광지 검색
 *
 * bounding box: 대한민국 영토 (33.0,124.0,39.0,132.0)
 * OSM에서 tourism=attraction|museum|viewpoint + name 정확 일치 검색
 */
async function searchOverpass(keyword: string): Promise<OverpassPOI | null> {
  if (!keyword || keyword.trim().length < 2) return null;

  // Rate limit 준수
  const now = Date.now();
  const wait = OVERPASS_MIN_INTERVAL_MS - (now - lastOverpassCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastOverpassCall = Date.now();

  // 정확한 name 일치 검색 (느린 regex 대신)
  const bbox = '33.0,124.0,39.0,132.0';
  const q = `[out:json][timeout:8];nwr["name"="${keyword}"](${bbox});out 5;`;

  try {
    const res = await fetch(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      elements?: Array<{
        type: string; lat?: number; lon?: number; center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    };

    if (!json.elements || json.elements.length === 0) return null;

    // tourism=attraction 우선 정렬
    const sorted = json.elements.sort((a, b) => {
      const aScore = a.tags?.tourism === 'attraction' ? 2 : a.tags?.tourism ? 1 : 0;
      const bScore = b.tags?.tourism === 'attraction' ? 2 : b.tags?.tourism ? 1 : 0;
      return bScore - aScore;
    });

    const top = sorted[0];
    const lat = top.lat ?? top.center?.lat ?? null;
    const lon = top.lon ?? top.center?.lon ?? null;

    return {
      source: 'overpass',
      name: top.tags?.name ?? keyword,
      nameKo: top.tags?.['name:ko'] ?? null,
      type: top.type as 'node' | 'way' | 'relation',
      lat,
      lon,
      tourism: top.tags?.tourism ?? null,
      historic: top.tags?.historic ?? null,
      description: top.tags?.description ?? top.tags?.note ?? null,
      osmUrl: `https://www.openstreetmap.org/${top.type}/${top.type === 'node' ? '' : ''}`,
    };
  } catch {
    return null;
  }
}

/**
 * Wikidata API로 POI 검색
 * 기존 suggestFromWikidata 활용, 인터페이스 통일
 */
async function searchWikidataPOI(keyword: string): Promise<WikidataPOI | null> {
  if (!keyword || keyword.trim().length < 2) return null;

  const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

  // 한국어 우선 검색
  const searchUrl = (lang: string) =>
    `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(keyword)}&language=${lang}&format=json&limit=1&type=item`;

  try {
    let qid: string | null = null;
    let labelKo: string | null = null;
    let labelEn: string | null = null;
    let description: string | null = null;

    // 한국어 검색
    const resKo = await fetch(searchUrl('ko'), { headers: { 'User-Agent': USER_AGENT } });
    if (resKo.ok) {
      const json = await resKo.json() as { search?: Array<{ id: string; label: string; description?: string }> };
      if (json.search?.[0]) {
        qid = json.search[0].id;
        labelKo = json.search[0].label;
        description = json.search[0].description ?? null;
      }
    }

    // 한국어 실패 시 영어 fallback
    if (!qid) {
      const resEn = await fetch(searchUrl('en'), { headers: { 'User-Agent': USER_AGENT } });
      if (resEn.ok) {
        const json = await resEn.json() as { search?: Array<{ id: string; label: string; description?: string }> };
        if (json.search?.[0]) {
          qid = json.search[0].id;
          labelEn = json.search[0].label;
          description = json.search[0].description ?? null;
        }
      }
    }

    if (!qid) return null;

    // 상세 정보 조회 (image 등)
    const detailUrl = `${WIKIDATA_API}?action=wbgetentities&ids=${qid}&props=claims&format=json`;
    const resDetail = await fetch(detailUrl, { headers: { 'User-Agent': USER_AGENT } });
    let imageThumbUrl: string | null = null;
    if (resDetail.ok) {
      const detail = await resDetail.json() as {
        entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value: string } } }>> }>;
      };
      const imageFilename = detail.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (imageFilename) {
        imageThumbUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageFilename)}?width=400`;
      }
    }

    return {
      source: 'wikidata',
      qid,
      labelKo,
      labelEn,
      description,
      imageThumbUrl,
    };
  } catch {
    return null;
  }
}

/**
 * 외부 POI 검색 실행
 *
 * @param keyword 검색어 (관광지명)
 * @returns 정규화된 외부 POI 검색 결과
 */
export async function searchExternalPOI(keyword: string): Promise<ExternalPOISearchResult | null> {
  if (!keyword || keyword.trim().length < 2) return null;

  // 1차: Overpass API (OSM, 정확한 이름 매칭)
  const overpass = await searchOverpass(keyword);

  if (overpass) {
    const confidence = overpass.tourism === 'attraction' ? 85
      : overpass.tourism ? 75
      : overpass.historic ? 70
      : 60;
    return {
      confidence,
      source: 'overpass',
      displayName: overpass.nameKo ?? overpass.name,
      raw: overpass,
    };
  }

  // 2차: Wikidata API
  const wikidata = await searchWikidataPOI(keyword);
  if (wikidata) {
    return {
      confidence: 70,
      source: 'wikidata',
      displayName: wikidata.labelKo ?? wikidata.labelEn ?? keyword,
      raw: wikidata,
    };
  }

  return null;
}

/**
 * 외부 POI 검색 결과를 note 컬럼에 저장할 JSON 문자열로 변환
 */
export function externalPOIToNote(result: ExternalPOISearchResult, searchedAt: string): string {
  const base = {
    searched_at: searchedAt,
    source: result.source,
    confidence: result.confidence,
    display_name: result.displayName,
  };

  if (result.source === 'overpass') {
    const o = result.raw as OverpassPOI;
    return JSON.stringify({
      ...base,
      name: o.name,
      name_ko: o.nameKo,
      type: o.type,
      lat: o.lat,
      lon: o.lon,
      tourism: o.tourism,
      historic: o.historic,
    });
  }

  // wikidata
  const w = result.raw as WikidataPOI;
  return JSON.stringify({
    ...base,
    qid: w.qid,
    label_ko: w.labelKo,
    label_en: w.labelEn,
    description: w.description,
    image_thumb_url: w.imageThumbUrl,
  });
}
