/**
 * Instagram Hashtag Search + Business Discovery — 외부 트렌드 학습용 (PR-3)
 *
 * Meta Graph API v21:
 *   1. IG Hashtag Search
 *      GET /ig_hashtag_search?user_id={ig-user-id}&q={hashtag}
 *        → { data: [{ id }] }
 *      LIMIT: 30 unique hashtags per IG account per rolling 7 days.
 *
 *   2. Hashtag Top Media
 *      GET /{hashtag-id}/top_media?user_id={ig-user-id}
 *        &fields=id,media_type,media_url,permalink,caption,like_count,comments_count,timestamp
 *        → { data: [...] }
 *
 *   3. Business Discovery
 *      GET /{ig-user-id}?fields=business_discovery.username({other}){media{...}}
 *
 * 모든 호출은 Meta v. Bright Data 2024 판례 범위 안 (logged-off public data).
 * PII 미저장 — username·profile_pic 추출 X. 본문(caption)만 scrub 후 저장.
 */

import { resolveMetaToken } from './meta-token-resolver';
import { getSecret } from './secret-registry';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

export interface IgMedia {
  id: string;
  media_type?: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url?: string;
  permalink?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
}

export interface IgSearchResult<T> {
  ok: boolean;
  data: T[];
  error?: string;
}

const MEDIA_FIELDS = 'id,media_type,media_url,permalink,caption,like_count,comments_count,timestamp';

export function isIgSearchConfigured(): boolean {
  return !!(
    (getSecret('META_ACCESS_TOKEN') || getSecret('META_GRAPH_ACCESS_TOKEN')) &&
    getSecret('META_IG_USER_ID')
  );
}

async function getIgConfig(): Promise<{ igUserId: string; token: string } | null> {
  const igUserId = getSecret('META_IG_USER_ID');
  if (!igUserId) return null;
  const token =
    (await resolveMetaToken('META_ACCESS_TOKEN')) ||
    (await resolveMetaToken('META_GRAPH_ACCESS_TOKEN'));
  if (!token) return null;
  return { igUserId, token };
}

/**
 * 해시태그명 → hashtag_id (Meta 내부 ID).
 * 7일 30개 unique 한도 — caller에서 회전 관리.
 */
export async function searchHashtagId(
  hashtag: string,
): Promise<{ ok: boolean; hashtagId?: string; error?: string }> {
  const config = await getIgConfig();
  if (!config) return { ok: false, error: 'IG 토큰/USER_ID 미설정' };

  const cleaned = hashtag.replace(/^#/, '').trim();
  if (!cleaned) return { ok: false, error: '해시태그 비어있음' };

  const url = new URL(`${GRAPH_API_BASE}/ig_hashtag_search`);
  url.searchParams.set('user_id', config.igUserId);
  url.searchParams.set('q', cleaned);
  url.searchParams.set('access_token', config.token);

  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    const id = data?.data?.[0]?.id;
    if (!id) return { ok: false, error: 'hashtag_id 없음' };
    return { ok: true, hashtagId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 해시태그 top_media (engagement 정렬).
 * limit: Meta는 일반적으로 25개/페이지 반환.
 */
export async function getHashtagTopMedia(
  hashtagId: string,
): Promise<IgSearchResult<IgMedia>> {
  const config = await getIgConfig();
  if (!config) return { ok: false, data: [], error: 'IG 토큰 미설정' };

  const url = new URL(`${GRAPH_API_BASE}/${hashtagId}/top_media`);
  url.searchParams.set('user_id', config.igUserId);
  url.searchParams.set('fields', MEDIA_FIELDS);
  url.searchParams.set('access_token', config.token);

  try {
    const res = await fetch(url.toString());
    const json = await res.json();
    if (!res.ok) return { ok: false, data: [], error: json?.error?.message || `HTTP ${res.status}` };
    return { ok: true, data: Array.isArray(json?.data) ? json.data : [] };
  } catch (err) {
    return { ok: false, data: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 경쟁사 IG public 계정 미디어 (Business Discovery).
 * username = 인스타 핸들 (예: 'myrealtrip', 'norangtour').
 */
export async function businessDiscoveryMedia(
  username: string,
  limit = 20,
): Promise<IgSearchResult<IgMedia>> {
  const config = await getIgConfig();
  if (!config) return { ok: false, data: [], error: 'IG 토큰 미설정' };

  const cleaned = username.replace(/^@/, '').trim();
  if (!cleaned) return { ok: false, data: [], error: 'username 비어있음' };

  const fieldsExpr = `business_discovery.username(${cleaned}){media.limit(${limit}){${MEDIA_FIELDS}}}`;
  const url = new URL(`${GRAPH_API_BASE}/${config.igUserId}`);
  url.searchParams.set('fields', fieldsExpr);
  url.searchParams.set('access_token', config.token);

  try {
    const res = await fetch(url.toString());
    const json = await res.json();
    if (!res.ok) return { ok: false, data: [], error: json?.error?.message || `HTTP ${res.status}` };
    const media: IgMedia[] = json?.business_discovery?.media?.data ?? [];
    return { ok: true, data: media };
  } catch (err) {
    return { ok: false, data: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 해시태그 풀에서 7일 한도 안에 회전 가능한 N개 선택.
 * @param pool {hashtag, last_used_at}[]
 * @param limit 일별 호출할 해시태그 수 (예: 4)
 * @param windowDays 7
 */
export function pickRotatedHashtags(
  pool: Array<{ hashtag: string; last_used_at: string | null }>,
  limit: number,
  windowDays = 7,
): string[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  // 마지막 사용 시각 기준 오래된 것부터 — null은 최우선
  const sorted = [...pool].sort((a, b) => {
    const ta = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
    const tb = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
    return ta - tb;
  });

  const picked: string[] = [];
  for (const item of sorted) {
    if (picked.length >= limit) break;
    picked.push(item.hashtag);
  }
  return picked;
}
