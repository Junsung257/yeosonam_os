/**
 * @file ota-name-normalizer.ts — 하나투어/모두투어 검색 결과로부터 관광지 표기 정형화 (2026-05-15 박제)
 *
 * 사장님 비전 V5 (이전 세션 메모리 + 본 세션 확인):
 *   "하나투어 모두투어 검색해서 표기 정규화/정형화 — 관광지 이름 alias 흡수"
 *
 * 저작권 안전:
 *   - 사실(공개 명칭)은 저작권 대상 아님 (표현만 보호) → 이름·표기 추출은 안전
 *   - description 차용은 paraphrase-enforcer 가 cosine ≤ 0.6 으로 별도 검증
 *   - 출처 URL 보존, User-Agent 명시, 1 attraction = 1 request, fail-soft
 *
 * 동작:
 *   1. 하나투어/모두투어 검색 URL fetch (정적 SSR 페이지만 작동)
 *   2. HTML <title> + product card titles 추출
 *   3. attraction 키워드 변형 alias 후보 추출
 *   4. attractions.aliases 컬럼에 union 으로 추가
 *
 * 실패 (SPA 라 빈 HTML / timeout / 403 등) 는 swallow — 다른 source fallback 작동.
 */

const HANATOUR_SEARCH = (keyword: string) =>
  `https://www.hanatour.com/search?keyword=${encodeURIComponent(keyword)}`;
const MODETOUR_SEARCH = (keyword: string) =>
  `https://www.modetour.com/search?searchword=${encodeURIComponent(keyword)}`;

const USER_AGENT = 'YeosonamOS/1.0 (catalog assist; contact: admin@yeosonam.com)';
const FETCH_TIMEOUT_MS = 6000;
const MAX_ALIASES_PER_SOURCE = 3;

export interface OtaAlias {
  alias: string;
  source: 'hanatour' | 'modetour';
  source_url: string;
  fetched_at: string;
}

/**
 * 검색 결과 페이지에서 attraction 키워드 변형을 추출.
 * 보수적 휴리스틱 — false positive (랜덤 상품명) 차단:
 *   1. 길이 2~30자
 *   2. 한국어 또는 영문 또는 베트남어/일본어/중국어 포함
 *   3. attractionName 의 핵심 글자 (3+) 포함하거나 영문 약자 매치
 *   4. 패키지 일반어 (4박/5일/완전판/특가/PLUS 등) 제외
 */
function isPlausibleAlias(candidate: string, attractionName: string): boolean {
  const c = candidate.trim();
  if (c.length < 2 || c.length > 30) return false;
  // 패키지 노이즈 제외
  if (/\d+박\d+일|\[(특가|즉시확정|얼리|할인|단독|PLUS|핫딜)\]|완전판|풀빌라|에어텔|크루즈|크리스마스|연말/i.test(c)) return false;
  // 핵심 글자 매치: attraction 의 3자 연속 substring 또는 영문 4자 연속
  const korN = 3;
  for (let i = 0; i <= attractionName.length - korN; i++) {
    const sub = attractionName.slice(i, i + korN);
    if (/[가-힣]/.test(sub) && c.includes(sub)) return true;
  }
  const enRe = attractionName.match(/[a-zA-Z]{4,}/);
  if (enRe && c.toLowerCase().includes(enRe[0].toLowerCase())) return true;
  return false;
}

/** HTML 에서 product card / search title 추출 — 정적 SSR 만 작동. */
function extractTitlesFromHtml(html: string): string[] {
  const out: string[] = [];
  // <title> 자체
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) out.push(titleMatch[1].trim());
  // alt 텍스트 (image based product cards)
  const altRe = /\balt=["']([^"']{2,60})["']/g;
  let m: RegExpExecArray | null;
  while ((m = altRe.exec(html)) !== null) out.push(m[1].trim());
  // <h2 ~ h4> title patterns
  const headerRe = /<h[2-4][^>]*>([^<]{2,80})<\/h[2-4]>/g;
  while ((m = headerRe.exec(html)) !== null) out.push(m[1].trim());
  // og:title meta
  const ogRe = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i;
  const og = ogRe.exec(html);
  if (og) out.push(og[1].trim());
  return out;
}

async function fetchOtaSource(url: string): Promise<string | null> {
  // G3 placeholder (2026-05-15): headless browser (Vercel Sandbox + @sparticuz/chromium) 확장 자리.
  //   ENABLE_PLAYWRIGHT_OTA=1 env flag 시 fetchOtaWithBrowser() 호출 → SPA 사이트 SSR rendering.
  //   현재는 정적 fetch 만. 사장님 Vercel Pro plan 결정 후 playwright-core + @sparticuz/chromium 박제.
  if (process.env.ENABLE_PLAYWRIGHT_OTA === '1') {
    try {
      const { fetchOtaWithBrowser } = await import('./ota-playwright-fetcher');
      const html = await fetchOtaWithBrowser(url);
      if (html && html.length >= 1000) return html;
    } catch (e) {
      console.warn('[OTA] playwright fetcher 실패(무시 정적 fallback):', e instanceof Error ? e.message : e);
    }
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const text = await res.text();
    // SPA placeholder 감지 (실제 콘텐츠 없는 경우 길이 작음)
    if (text.length < 1000) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * Public API — attractionName 으로 하나투어/모두투어 alias 후보 추출.
 * SPA 일 가능성 높아 실제 작동률 낮을 수 있지만 SSR 페이지에선 정상 작동.
 */
export async function fetchOtaAliasCandidates(attractionName: string): Promise<OtaAlias[]> {
  const name = attractionName.trim();
  if (!name) return [];

  const out: OtaAlias[] = [];
  const sources: { source: 'hanatour' | 'modetour'; url: string }[] = [
    { source: 'hanatour', url: HANATOUR_SEARCH(name) },
    { source: 'modetour', url: MODETOUR_SEARCH(name) },
  ];

  for (const src of sources) {
    const html = await fetchOtaSource(src.url);
    if (!html) continue;
    const titles = extractTitlesFromHtml(html);
    const aliases = new Set<string>();
    for (const t of titles) {
      // 콤마/슬래시/꺽쇠 split 후 검증
      const parts = t.split(/[,，\/·\[\]【】｜|]/).map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        if (isPlausibleAlias(part, name) && part !== name) aliases.add(part);
        if (aliases.size >= MAX_ALIASES_PER_SOURCE) break;
      }
      if (aliases.size >= MAX_ALIASES_PER_SOURCE) break;
    }
    for (const a of aliases) {
      out.push({ alias: a, source: src.source, source_url: src.url, fetched_at: new Date().toISOString() });
    }
    // rate limit between sources
    await new Promise(r => setTimeout(r, 400));
  }

  return out;
}
