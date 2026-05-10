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
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        posts: [],
        error: data?.error?.message || `HTTP ${res.status}`,
      };
    }
    const posts: ThreadsSearchPost[] = Array.isArray(data?.data) ? data.data : [];
    return { ok: true, posts };
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
