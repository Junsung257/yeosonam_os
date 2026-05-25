/**
 * Related Queries — Naver Search API 기반 연관 검색어 수집
 *
 * 책임:
 *   1) Naver Search API (webkr.json) 호출 → 연관 키워드 추출
 *   2) Rate limit 1초 간격 적용
 *   3) 메모리 캐시 (TTL 1시간)
 *
 * 사용: keyword-research.ts 의 researchKeyword() 가 호출하여
 *      keyword_research_cache.related_queries 를 채움
 */

import { getSecret } from './secret-registry';

// ── 메모리 캐시 ────────────────────────────────────────────

interface CacheEntry {
  queries: string[];
  expiresAt: number;
}

const relatedQueriesCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간

// ── Rate limit ─────────────────────────────────────────────

let lastCallTime = 0;
const RATE_LIMIT_MS = 1000; // 1초 간격

/**
 * Naver Search API 호출 간격 보장
 */
async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastCallTime = Date.now();
}

// ── 한국어 명사/키워드 추출 (간단 휴리스틱) ─────────────────

/**
 * 결과 제목에서 원본 키워드를 제외한 주요 단어(명사 위주) 추출
 *
 * 간단한 규칙:
 * - HTML 태그/엔티티 제거
 * - 2글자 이상, 한글/영어 단어만 유지
 * - 원본 키워드 포함 시 제외
 * - 불용어 제외
 */
function extractKeywords(title: string, originalKeyword: string): string[] {
  const clean = title
    .replace(/<[^>]+>/g, '')
    .replace(/&[^;]+;/g, '')
    .replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, ' ')
    .trim();

  const tokens = clean.split(/\s+/).filter(t => t.length >= 2);
  const originalTokens = originalKeyword.split(/\s+/).map(t => t.trim()).filter(Boolean);

  const STOP_WORDS = new Set([
    '합니다', '있습니다', '그리고', '하지만', '그래서', '때문',
    '통해', '대한', '관련', '모든', '다양', '이런', '저런',
    '정도', '가장', '매우', '너무', '아주', '다시', '지금',
    '으로', '에게', '위한', '통한',
  ]);

  const result = new Set<string>();

  for (const token of tokens) {
    const lower = token.toLowerCase();
    // 원본 키워드 포함 제외
    if (originalTokens.some(ot => lower.includes(ot.toLowerCase()) || ot.toLowerCase().includes(lower))) continue;
    // 불용어 제외
    if (STOP_WORDS.has(lower)) continue;
    // 숫자만 제외
    if (/^\d+$/.test(token)) continue;
    result.add(token);
  }

  return Array.from(result).slice(0, 3); // 제목당 최대 3개
}

/**
 * Naver Search API를 통해 연관 키워드 수집
 *
 * 호출: /v1/search/webkr.json?query={keyword}&display=5
 * 응답에서 각 결과 제목에서 키워드 추출
 * 실패 시 빈 배열 반환 (기존 동작 유지)
 */
export async function fetchRelatedQueries(keyword: string): Promise<string[]> {
  // 1) 메모리 캐시 확인
  const cached = relatedQueriesCache.get(keyword);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.queries;
  }

  const clientId = getSecret('NAVER_CLIENT_ID');
  const clientSecret = getSecret('NAVER_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    console.log('[related-queries] Naver API 키 없음 — 빈 배열 반환');
    return [];
  }

  try {
    await rateLimitWait();

    const url = `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(keyword)}&display=5`;
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[related-queries] Naver Search API HTTP ${res.status} — 빈 배열 반환`);
      return [];
    }

    const data = await res.json();
    const items = (data.items || []) as Array<{ title: string; description: string }>;

    // 각 결과 제목에서 키워드 추출 → 통합
    const allKeywords = new Set<string>();
    for (const item of items) {
      const extracted = extractKeywords(item.title, keyword);
      for (const ek of extracted) {
        allKeywords.add(ek);
      }
    }

    // 원본 키워드 완전히 동일한 경우 제외
    const result = Array.from(allKeywords)
      .filter(k => k.toLowerCase() !== keyword.toLowerCase())
      .slice(0, 5);

    // 메모리 캐시 저장
    relatedQueriesCache.set(keyword, {
      queries: result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return result;
  } catch (err) {
    console.warn('[related-queries] 연관 검색어 수집 실패:',
      err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 메모리 캐시 초기화 (테스트/디버깅용)
 */
export function clearRelatedQueriesCache(): void {
  relatedQueriesCache.clear();
}
