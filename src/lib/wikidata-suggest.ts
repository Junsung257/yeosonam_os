/**
 * @file wikidata-suggest.ts — 미매칭 키워드 → Wikidata 정규화 후보 조회.
 *
 * STRICT SSOT 흐름 (ERR-XIY-2026-05-16, PR #87 Phase 1):
 *   미매칭 큐 항목에 대해 Wikidata top hit 검색 → QID + 다국어 labels + aliases + P18 image
 *   추출. 자동 INSERT 안 함. 사장님이 어드민에서 카드 보고 ☑ 클릭 시 신규 attraction 등록.
 *
 * 라이선스: Wikidata = CC0 (무료, 상업 자유, attribution 불요).
 * Rate limit: 공식 가이드 없으나 User-Agent 식별 필수. 우리 배치 호출은 50ms 간격.
 */
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) attraction-matcher';

export interface WikidataSuggestion {
  qid: string;
  description: string | null;
  labels: { ko: string | null; en: string | null; zh: string | null; ja: string | null };
  aliases: { ko: string[]; en: string[]; zh: string[]; ja: string[] };
  /** Wikimedia Commons file name (P18). 모바일 카드 사진 후보. */
  image_filename: string | null;
  /** image_filename 으로 만든 thumbnail URL (Wikimedia Commons). */
  image_thumb_url: string | null;
  sitelinks: { kowiki: string | null; enwiki: string | null; zhwiki: string | null };
}

/**
 * 1단계: wbsearchentities 로 키워드 → top hit QID 검색.
 *   한국어 우선, miss 시 영어 fallback.
 */
async function searchEntityQid(keyword: string, lang: 'ko' | 'en' = 'ko'): Promise<string | null> {
  const url =
    `${WIKIDATA_API}?action=wbsearchentities` +
    `&search=${encodeURIComponent(keyword)}` +
    `&language=${lang}` +
    `&format=json` +
    `&limit=1` +
    `&type=item`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  const json = await res.json() as { search?: Array<{ id: string }> };
  return json.search?.[0]?.id ?? null;
}

/**
 * 2단계: wbgetentities 로 QID → labels/aliases/claims(P18)/sitelinks 일괄 조회.
 */
async function fetchEntityDetail(qid: string): Promise<WikidataSuggestion | null> {
  const url =
    `${WIKIDATA_API}?action=wbgetentities` +
    `&ids=${qid}` +
    `&props=labels%7Caliases%7Cclaims%7Csitelinks%7Cdescriptions` +
    `&languages=ko%7Cen%7Czh%7Cja` +
    `&sitefilter=kowiki%7Cenwiki%7Czhwiki` +
    `&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  const json = await res.json() as {
    entities?: Record<string, {
      labels?: Record<string, { value: string }>;
      aliases?: Record<string, Array<{ value: string }>>;
      claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value: string } } }>>;
      sitelinks?: Record<string, { title: string }>;
      descriptions?: Record<string, { value: string }>;
    }>;
  };
  const e = json.entities?.[qid];
  if (!e) return null;

  const getLabel = (lang: string) => e.labels?.[lang]?.value ?? null;
  const getAliases = (lang: string) => (e.aliases?.[lang] ?? []).map(a => a.value);
  const imageFilename = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value ?? null;
  const imageThumb = imageFilename
    ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageFilename)}?width=800`
    : null;
  const description = e.descriptions?.ko?.value ?? e.descriptions?.en?.value ?? null;

  return {
    qid,
    description,
    labels: {
      ko: getLabel('ko'),
      en: getLabel('en'),
      zh: getLabel('zh'),
      ja: getLabel('ja'),
    },
    aliases: {
      ko: getAliases('ko'),
      en: getAliases('en'),
      zh: getAliases('zh'),
      ja: getAliases('ja'),
    },
    image_filename: imageFilename,
    image_thumb_url: imageThumb,
    sitelinks: {
      kowiki: e.sitelinks?.kowiki?.title ?? null,
      enwiki: e.sitelinks?.enwiki?.title ?? null,
      zhwiki: e.sitelinks?.zhwiki?.title ?? null,
    },
  };
}

/**
 * 미매칭 키워드 → Wikidata 정규화 후보 1건.
 *
 * @param keyword 미매칭 activity 텍스트 (이미 클린 후 권장)
 * @returns top hit 1건 또는 null (미매칭)
 */
export async function suggestFromWikidata(keyword: string): Promise<WikidataSuggestion | null> {
  if (!keyword || keyword.trim().length < 2) return null;

  // 한국어 → 영어 fallback (해외 관광지는 한국어 라벨 없을 수 있음)
  let qid = await searchEntityQid(keyword, 'ko');
  if (!qid) qid = await searchEntityQid(keyword, 'en');
  if (!qid) return null;

  return fetchEntityDetail(qid);
}

/**
 * 다국어 라벨 + aliases 를 평탄화. attraction.aliases 컬럼 import 용.
 *   중복 제거 + 캐노니컬 라벨(ko)은 attraction.name 으로 가므로 alias 에서 제외.
 */
export function flattenWikidataAliases(s: WikidataSuggestion): string[] {
  const canonical = s.labels.ko ?? s.labels.en;
  const all = [
    s.labels.ko,
    s.labels.en,
    s.labels.zh,
    s.labels.ja,
    ...s.aliases.ko,
    ...s.aliases.en,
    ...s.aliases.zh,
    ...s.aliases.ja,
  ].filter((v): v is string => !!v && v !== canonical);
  return [...new Set(all)];
}
