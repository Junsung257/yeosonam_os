/**
 * @file wikipedia-summary.ts — Wikipedia REST API summary 그라운딩.
 *
 * STRICT SSOT 흐름 (PR #88 Phase 2a):
 *   attraction 의 short_desc/long_desc 가 비어 있을 때 사장님 어드민에서 1-click 으로
 *   Wikipedia 한국어 → 영어 fallback summary 자동 채움. 자동 INSERT 아님, 사장님 명시 트리거.
 *
 * 라이선스: Wikipedia 본문 CC-BY-SA. attribution 의무 — DB 에 source_url 보존.
 * Rate limit: 200 req/s (no key), User-Agent 식별 필수.
 */
const REST_API_HOST: Record<'ko' | 'en' | 'zh' | 'ja', string> = {
  ko: 'https://ko.wikipedia.org',
  en: 'https://en.wikipedia.org',
  zh: 'https://zh.wikipedia.org',
  ja: 'https://ja.wikipedia.org',
};
const USER_AGENT = 'YeosonamOS/1.0 (https://yeosonam.com; admin@yeosonam.com) attraction-enricher';

export interface WikipediaSummary {
  lang: 'ko' | 'en' | 'zh' | 'ja';
  title: string;
  extract: string;
  extract_short: string;
  description: string | null;
  page_url: string;
  thumbnail_url: string | null;
  coordinates: { lat: number; lon: number } | null;
}

/**
 * 단일 언어 Wikipedia summary fetch.
 *
 * @param title Wikipedia 문서 제목 (URL-safe 필요 없음, 내부 encode)
 * @param lang 'ko' | 'en' | 'zh' | 'ja'
 * @returns summary 또는 null (404 / Disambiguation page / Empty)
 */
export async function fetchWikipediaSummary(
  title: string,
  lang: 'ko' | 'en' | 'zh' | 'ja',
): Promise<WikipediaSummary | null> {
  if (!title) return null;
  const host = REST_API_HOST[lang];
  const url = `${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}?redirect=true`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      type?: string;
      title?: string;
      extract?: string;
      description?: string | null;
      thumbnail?: { source?: string };
      coordinates?: { lat: number; lon: number };
      content_urls?: { desktop?: { page?: string } };
    };
    if (json.type === 'disambiguation' || !json.extract) return null;
    const extract = json.extract.trim();
    const extract_short = extract.split('. ').slice(0, 1).join('. ').slice(0, 120);
    return {
      lang,
      title: json.title ?? title,
      extract,
      extract_short,
      description: json.description ?? null,
      page_url: json.content_urls?.desktop?.page ?? `${host}/wiki/${encodeURIComponent(title)}`,
      thumbnail_url: json.thumbnail?.source ?? null,
      coordinates: json.coordinates ? { lat: json.coordinates.lat, lon: json.coordinates.lon } : null,
    };
  } catch {
    return null;
  }
}

/**
 * 다국어 fallback fetch. ko 우선, miss 시 en, zh, ja 순.
 *
 * @param sitelinks Wikidata sitelinks 형태 (선택). 있으면 각 언어별 정확한 title 사용,
 *                  없으면 keyword 를 그대로 title 로 시도.
 */
export async function fetchWikipediaWithFallback(
  keyword: string,
  sitelinks?: { kowiki: string | null; enwiki: string | null; zhwiki: string | null; jawiki?: string | null },
): Promise<WikipediaSummary | null> {
  const candidates: Array<{ lang: 'ko' | 'en' | 'zh' | 'ja'; title: string }> = [];
  if (sitelinks?.kowiki) candidates.push({ lang: 'ko', title: sitelinks.kowiki });
  else if (keyword) candidates.push({ lang: 'ko', title: keyword });
  if (sitelinks?.enwiki) candidates.push({ lang: 'en', title: sitelinks.enwiki });
  if (sitelinks?.zhwiki) candidates.push({ lang: 'zh', title: sitelinks.zhwiki });
  if (sitelinks?.jawiki) candidates.push({ lang: 'ja', title: sitelinks.jawiki });

  for (const { lang, title } of candidates) {
    const summary = await fetchWikipediaSummary(title, lang);
    if (summary && summary.extract.length >= 30) return summary;
  }
  return null;
}
