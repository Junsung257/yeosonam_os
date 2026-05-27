/**
 * Node.js용 외부 POI 검색 (내부 모듈 import 없이 독립 실행)
 *
 * Overpass API (OSM) + Wikidata API 검색, 모두 무료, 키 불필요
 */
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) batch-resolve';
let lastOverpassCall = 0;

/**
 * Overpass API로 정확한 name 일치 검색
 * Bounding box: 대한민국 영토
 */
async function searchOverpass(keyword) {
  if (!keyword || keyword.trim().length < 2) return null;

  // Rate limit: 1초 간격
  const now = Date.now();
  const wait = 1000 - (now - lastOverpassCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastOverpassCall = Date.now();

  const bbox = '33.0,124.0,39.0,132.0';
  const q = `[out:json][timeout:8];nwr["name"="${keyword}"](${bbox});out 5;`;

  const res = await fetch(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.elements || json.elements.length === 0) return null;

  // tourism=attraction 우선 정렬
  const sorted = json.elements.sort((a, b) => {
    const aScore = a.tags?.tourism === 'attraction' ? 2 : a.tags?.tourism ? 1 : 0;
    const bScore = b.tags?.tourism === 'attraction' ? 2 : b.tags?.tourism ? 1 : 0;
    return bScore - aScore;
  });

  const top = sorted[0];
  return {
    source: 'overpass',
    name: top.tags?.name || keyword,
    nameKo: top.tags?.['name:ko'] || null,
    tourism: top.tags?.tourism || null,
    historic: top.tags?.historic || null,
    lat: top.lat || top.center?.lat || null,
    lon: top.lon || top.center?.lon || null,
    description: top.tags?.description || top.tags?.note || null,
  };
}

/**
 * Wikidata API로 POI 검색
 */
async function searchWikidata(keyword) {
  if (!keyword || keyword.trim().length < 2) return null;

  // 한국어 검색
  const url = (lang) => `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(keyword)}&language=${lang}&format=json&limit=1&type=item`;

  let qid = null, labelKo = null, labelEn = null, description = null;

  const rKo = await fetch(url('ko'), { headers: { 'User-Agent': USER_AGENT } });
  if (rKo.ok) {
    const j = await rKo.json();
    if (j.search?.[0]) {
      qid = j.search[0].id;
      labelKo = j.search[0].label;
      description = j.search[0].description || null;
    }
  }

  if (!qid) {
    const rEn = await fetch(url('en'), { headers: { 'User-Agent': USER_AGENT } });
    if (rEn.ok) {
      const j = await rEn.json();
      if (j.search?.[0]) {
        qid = j.search[0].id;
        labelEn = j.search[0].label;
        description = j.search[0].description || null;
      }
    }
  }

  if (!qid) return null;

  // 이미지 조회
  const rd = await fetch(`${WIKIDATA_API}?action=wbgetentities&ids=${qid}&props=claims&format=json`,
    { headers: { 'User-Agent': USER_AGENT } });
  let imageThumbUrl = null;
  if (rd.ok) {
    const d = await rd.json();
    const fn = d.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (fn) imageThumbUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fn)}?width=400`;
  }

  return {
    source: 'wikidata',
    qid,
    labelKo,
    labelEn,
    description,
    imageThumbUrl,
  };
}

/**
 * 외부 POI 검색 (1차: Overpass, 2차: Wikidata)
 */
async function searchExternalPOI(keyword) {
  if (!keyword || keyword.trim().length < 2) return null;

  // Overpass 먼저
  const op = await searchOverpass(keyword);
  if (op) {
    const confidence = op.tourism === 'attraction' ? 85
      : op.tourism ? 75
      : op.historic ? 70
      : 60;
    return { confidence, ...op, displayName: op.nameKo || op.name };
  }

  // Wikidata fallback
  const wd = await searchWikidata(keyword);
  if (wd) {
    return { confidence: 70, ...wd, displayName: wd.labelKo || wd.labelEn || keyword };
  }

  return null;
}

/**
 * 검색 결과를 note JSON으로 변환
 */
function resultToNote(result, searchedAt) {
  const base = { searched_at: searchedAt, source: result.source, confidence: result.confidence, display_name: result.displayName };
  if (result.source === 'overpass') {
    return JSON.stringify({ ...base, name: result.name, name_ko: result.nameKo, tourism: result.tourism, historic: result.historic, lat: result.lat, lon: result.lon });
  }
  return JSON.stringify({ ...base, qid: result.qid, label_ko: result.labelKo, label_en: result.labelEn, description: result.description, image_thumb_url: result.imageThumbUrl });
}

module.exports = { searchOverpass, searchWikidata, searchExternalPOI, resultToNote };
