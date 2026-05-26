/**
 * Threads Keyword Search API — 외부 트렌드 학습용 (PR-2)
 *
 * Meta 공식: https://developers.facebook.com/docs/threads/keyword-search
 *   GET /v1.0/keyword_search
 *     ?q={keyword}
 *     &search_type=TOP|RECENT
 *     &fields=id,text,timestamp,permalink,media_type,media_url,like_count,reply_count,repost_count,quote_count,share_count,views
 *     &access_token={token}
 *
 * 제약 (2026-01 기준):
 *   - 호출당 25개 결과
 *   - rate limit 200/hour per app
 *   - public posts only (private accounts 제외)
 *
 * 토큰 권한: threads_keyword_search 스코프 필요.
 */

import { resolveMetaToken } from './meta-token-resolver';
import { getSecret } from './secret-registry';

const GRAPH_API_BASE = 'https://graph.threads.net/v1.0';

// ── 재시도 설정 (fetchWithRetry와 동일한 패턴) ────────────────
const SEARCH_RETRY_CONFIG: {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  retryableStatuses: number[];
} = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 15000,
  jitterFactor: 0.25,
  retryableStatuses: [429, 500, 502, 503, 504],
};

function jitterMs(factor: number): number {
  return Math.round((Math.random() * 2 - 1) * factor * SEARCH_RETRY_CONFIG.baseDelayMs);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export interface ThreadsSearchPost {
  id: string;
  text: string;
  timestamp?: string;
  permalink?: string;
  media_type?: 'TEXT_POST' | 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'AUDIO' | 'REPOST_FACADE';
  media_url?: string;
  like_count?: number;
  reply_count?: number;
  repost_count?: number;
  quote_count?: number;
  share_count?: number;
  views?: number;
}

export interface ThreadsSearchResult {
  ok: boolean;
  posts: ThreadsSearchPost[];
  error?: string;
}

const FIELDS = [
  'id',
  'text',
  'timestamp',
  'permalink',
  'media_type',
  'like_count',
  'reply_count',
  'repost_count',
  'quote_count',
  'share_count',
  'views',
].join(',');

/**
 * 토큰 해석 — Threads 전용 토큰 우선, fallback Meta 공유 토큰.
 */
async function getThreadsSearchToken(): Promise<string | null> {
  return (
    (await resolveMetaToken('THREADS_ACCESS_TOKEN')) ||
    (await resolveMetaToken('META_ACCESS_TOKEN'))
  );
}

export function isThreadsSearchConfigured(): boolean {
  return !!(getSecret('THREADS_ACCESS_TOKEN') || getSecret('META_ACCESS_TOKEN'));
}

/**
 * Threads 키워드 검색.
 * @param keyword 한국어/영문 모두 허용
 * @param searchType TOP (engagement 정렬) 권장
 */
export async function searchThreadsByKeyword(
  keyword: string,
  searchType: 'TOP' | 'RECENT' = 'TOP',
): Promise<ThreadsSearchResult> {
  const token = await getThreadsSearchToken();
  if (!token) {
    return { ok: false, posts: [], error: 'Threads access token 없음' };
  }
  if (!keyword.trim()) {
    return { ok: false, posts: [], error: '키워드 비어있음' };
  }

  const url = new URL(`${GRAPH_API_BASE}/keyword_search`);
  url.searchParams.set('q', keyword);
  url.searchParams.set('search_type', searchType);
  url.searchParams.set('fields', FIELDS);
  url.searchParams.set('access_token', token);

  try {
    let lastError: string | undefined;
    let lastData: unknown;

    for (let attempt = 1; attempt <= SEARCH_RETRY_CONFIG.maxAttempts; attempt++) {
      if (attempt > 1) {
        const delay = Math.min(
          SEARCH_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1) + jitterMs(SEARCH_RETRY_CONFIG.jitterFactor),
          SEARCH_RETRY_CONFIG.maxDelayMs,
        );
        await sleep(delay);
      }

      const res = await fetch(url.toString());
      const data = await res.json();
      lastData = data;

      if (res.ok) {
        const posts: ThreadsSearchPost[] = Array.isArray(data?.data) ? data.data : [];
        return { ok: true, posts };
      }

      lastError = data?.error?.message || `HTTP ${res.status}`;

      // 재시도 불가능한 에러면 즉시 반환
      if (!SEARCH_RETRY_CONFIG.retryableStatuses.includes(res.status)) {
        return { ok: false, posts: [], error: lastError };
      }
    }

    return { ok: false, posts: [], error: lastError ?? '최대 재시도 횟수 초과' };
  } catch (err) {
    return {
      ok: false,
      posts: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 여러 키워드 순차 검색 (rate limit 회피용 딜레이 포함).
 */
export async function searchMultipleKeywords(
  keywords: string[],
  searchType: 'TOP' | 'RECENT' = 'TOP',
  delayMs = 400,
): Promise<Array<{ keyword: string; result: ThreadsSearchResult }>> {
  const results: Array<{ keyword: string; result: ThreadsSearchResult }> = [];
  for (const keyword of keywords) {
    const result = await searchThreadsByKeyword(keyword, searchType);
    results.push({ keyword, result });
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}
