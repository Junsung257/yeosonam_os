/**
 * Threads Graph API — 포스트 자동 발행
 *
 * Meta 공식 2단계 API (IG와 유사, 엔드포인트·permission 다름):
 *   1. POST /{threads_user_id}/threads
 *        → media_type=TEXT|IMAGE|VIDEO|CAROUSEL, text, image_url?, video_url?
 *        → media container ID 반환
 *   2. [필요 시] 컨테이너 폴링 (status_code: FINISHED 대기 — 이미지 있을 때만)
 *   3. POST /{threads_user_id}/threads_publish?creation_id={container}
 *        → 최종 threads_post_id (shortcode) 반환
 *
 * 캐러셀 (이미지 여러 장):
 *   a. 각 이미지마다 is_carousel_item=true container 생성
 *   b. 부모 container: media_type=CAROUSEL + children=[id1,id2,...]
 *   c. 폴링 → publish
 *
 * 제약 (2026-01 기준):
 *   - 텍스트 최대 500자
 *   - 캐러셀 최대 20장 (IG는 10장)
 *   - 24h 컨테이너 만료
 *   - 250 posts / 24h rolling (IG 는 25)
 *
 * 환경변수:
 *   - THREADS_ACCESS_TOKEN (전용) 또는 META_ACCESS_TOKEN (공유)
 *   - THREADS_USER_ID
 */

import { resolveMetaToken } from './meta-token-resolver';
import { getSecret } from './secret-registry';
import {
  detectEngagementBait,
  countWordsForThreadsHook,
  THREADS_HOOK_MIN_WORDS,
  THREADS_HOOK_MAX_WORDS,
  THREADS_HOOK_SWEET_SPOT_MAX,
} from './card-news/tokens';

const GRAPH_API_BASE = 'https://graph.threads.net/v1.0';

/**
 * Exponential Backoff + Jitter — 429/5xx 대응 (OpenAI/Meta 공식 패턴)
 *
 * - base = 1초, max = 30초
 * - jitter: ±25% (burst 동기화 방지)
 * - 429 Retry-After 헤더 존중
 * - 최대 5회 재시도 후 실패 반환
 */
const RETRY_CONFIG: {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  retryableStatuses: number[];
} = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.25,
  retryableStatuses: [429, 500, 502, 503, 504],
};

interface FetchWithRetryOptions {
  url: string;
  init?: RequestInit;
  label?: string;
}

async function fetchWithRetry({ url, init, label }: FetchWithRetryOptions): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);

      // 성공 (2xx) 또는 재시도 불가 (4xx except 429)
      if (res.ok) return res;
      if (!RETRY_CONFIG.retryableStatuses.includes(res.status)) return res;

      // ← 429: Retry-After 헤더 확인
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds) && seconds > 0 && seconds <= 60) {
            await sleep(seconds * 1000 + jitterMs(RETRY_CONFIG.jitterFactor));
            continue;
          }
        }
      }

      // ← 5xx: exponential backoff + jitter
      if (attempt < RETRY_CONFIG.maxAttempts) {
        const delay = Math.min(
          RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1),
          RETRY_CONFIG.maxDelayMs,
        );
        await sleep(delay + jitterMs(RETRY_CONFIG.jitterFactor));
        continue;
      }

      return res; // 마지막 시도: 응답 그대로 반환
    } catch (err) {
      // network error (DNS, timeout, connection refused)
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_CONFIG.maxAttempts) {
        const delay = Math.min(
          RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1),
          RETRY_CONFIG.maxDelayMs,
        );
        await sleep(delay + jitterMs(RETRY_CONFIG.jitterFactor));
      }
    }
  }

  throw lastError ?? new Error(`[${label ?? url}] fetch 실패 (${RETRY_CONFIG.maxAttempts}회 시도)`);
}

function jitterMs(factor: number): number {
  return Math.round((Math.random() * 2 - 1) * factor * 1000);
}

/**
 * Threads 본문 사전 검증 (PR-1 가드).
 *   - engagement-bait 패턴 거부 (Meta 2024-10 페널티)
 *   - hook 단어 수 6~20 권장 sweet spot (Berman 10K hook analysis)
 *
 * @returns null = 통과, string = 거부 사유
 */
export function validateThreadsBody(text: string): string | null {
  if (!text || text.trim().length === 0) return '본문 비어있음';
  if (text.length > 500) return `본문 500자 초과 (${text.length}자)`;

  const bait = detectEngagementBait(text);
  if (bait) return `engagement-bait 패턴 (Meta 페널티 대상): /${bait}/`;

  // hook = 첫 문장 (마침표/줄바꿈/느낌표/물음표 기준)
  const firstLine = text.split(/[.!?\n]/)[0] ?? text;
  const words = countWordsForThreadsHook(firstLine);
  if (words < THREADS_HOOK_MIN_WORDS) {
    return `hook 너무 짧음 (${words} 단어, 최소 ${THREADS_HOOK_MIN_WORDS})`;
  }
  if (words > THREADS_HOOK_MAX_WORDS) {
    return `hook 너무 김 (${words} 단어, 최대 ${THREADS_HOOK_MAX_WORDS}, sweet spot ≤${THREADS_HOOK_SWEET_SPOT_MAX})`;
  }
  return null;
}

export interface PublishThreadsInput {
  threadsUserId: string;
  accessToken: string;
  text: string;              // 메인 본문 (≤ 500자)
  imageUrls?: string[];      // 있으면 첨부. 1장: IMAGE, 2~20장: CAROUSEL
}

export interface ThreadsPublishResult {
  ok: boolean;
  postId?: string;           // threads_post_id (shortcode)
  error?: string;
  step?: string;
}

export function isThreadsConfigured(): boolean {
  return !!(
    (getSecret('THREADS_ACCESS_TOKEN') || getSecret('META_ACCESS_TOKEN')) &&
    getSecret('THREADS_USER_ID')
  );
}

/**
 * 토큰 해석 우선순위: env THREADS_ACCESS_TOKEN → env META_ACCESS_TOKEN →
 * DB system_secrets.THREADS_ACCESS_TOKEN → DB system_secrets.META_ACCESS_TOKEN.
 * Phase 7 자동 refresh 크론이 DB 에 최신 값을 유지.
 */
export async function getThreadsConfig(): Promise<{ threadsUserId: string; accessToken: string } | null> {
  const userId = getSecret('THREADS_USER_ID');
  if (!userId) return null;
  const token =
    (await resolveMetaToken('THREADS_ACCESS_TOKEN')) ||
    (await resolveMetaToken('META_ACCESS_TOKEN'));
  if (!token) return null;
  return { threadsUserId: userId, accessToken: token };
}

export async function publishToThreads(input: PublishThreadsInput): Promise<ThreadsPublishResult> {
  const { threadsUserId, accessToken, text, imageUrls } = input;

  const bodyError = validateThreadsBody(text);
  if (bodyError) {
    return { ok: false, step: 'validate', error: bodyError };
  }
  if (imageUrls && imageUrls.length > 20) {
    return { ok: false, step: 'validate', error: `이미지 20장 초과 (${imageUrls.length}장)` };
  }

  try {
    // ── 단일 텍스트 포스트 ──────────────────────────────────
    if (!imageUrls || imageUrls.length === 0) {
      const form = new URLSearchParams({
        media_type: 'TEXT',
        text,
        access_token: accessToken,
      });
      const res = await fetchWithRetry({ url: `${GRAPH_API_BASE}/${threadsUserId}/threads`, init: { method: 'POST', body: form }, label: 'text_container' });
      const data = await res.json();
      if (!res.ok || !data.id) {
        return { ok: false, step: 'text_container', error: data?.error?.message || JSON.stringify(data) };
      }
      return publishFromContainer(threadsUserId, accessToken, data.id as string);
    }

    // ── 단일 이미지 포스트 ──────────────────────────────────
    if (imageUrls.length === 1) {
      const form = new URLSearchParams({
        media_type: 'IMAGE',
        image_url: imageUrls[0],
        text,
        access_token: accessToken,
      });
      const res = await fetchWithRetry({ url: `${GRAPH_API_BASE}/${threadsUserId}/threads`, init: { method: 'POST', body: form }, label: 'image_container' });
      const data = await res.json();
      const poll = await pollContainerStatus(data.id, accessToken);
      if (!poll.ok) return { ok: false, step: 'image_poll', error: poll.error };
      return publishFromContainer(threadsUserId, accessToken, data.id as string);
    }

    // ── 캐러셀 (2~20장) ─────────────────────────────────────
    const childIds: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const form = new URLSearchParams({
        media_type: 'IMAGE',
        image_url: imageUrls[i],
        is_carousel_item: 'true',
        access_token: accessToken,
      });
      const res = await fetchWithRetry({ url: `${GRAPH_API_BASE}/${threadsUserId}/threads`, init: { method: 'POST', body: form }, label: `child_container_${i + 1}` });
      const data = await res.json();
      if (!res.ok || !data.id) {
        return { ok: false, step: `child_container_${i + 1}`, error: data?.error?.message || JSON.stringify(data) };
      }
      childIds.push(data.id);
      await sleep(300);
    }
    // PERF-01: parallel polling (sequential → 병렬). 20장일 때 N×90s → 90s max.
    const pollResults = await Promise.all(
      childIds.map((childId) => pollContainerStatus(childId, accessToken)),
    );
    for (let i = 0; i < pollResults.length; i++) {
      if (!pollResults[i].ok) return { ok: false, step: `child_poll_${i + 1}`, error: pollResults[i].error };
    }
    const parentForm = new URLSearchParams({
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      text,
      access_token: accessToken,
    });
    const parentRes = await fetchWithRetry({ url: `${GRAPH_API_BASE}/${threadsUserId}/threads`, init: { method: 'POST', body: parentForm }, label: 'carousel_container' });
    const parentData = await parentRes.json();
    if (!parentRes.ok || !parentData.id) {
      return { ok: false, step: 'carousel_container', error: parentData?.error?.message || JSON.stringify(parentData) };
    }
    const parentPoll = await pollContainerStatus(parentData.id, accessToken);
    if (!parentPoll.ok) return { ok: false, step: 'carousel_poll', error: parentPoll.error };
    return publishFromContainer(threadsUserId, accessToken, parentData.id as string);
  } catch (err) {
    return { ok: false, step: 'unexpected', error: err instanceof Error ? err.message : String(err) };
  }
}

async function publishFromContainer(
  threadsUserId: string,
  accessToken: string,
  containerId: string,
): Promise<ThreadsPublishResult> {
  const form = new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  });
  const res = await fetchWithRetry({ url: `${GRAPH_API_BASE}/${threadsUserId}/threads_publish`, init: { method: 'POST', body: form }, label: 'threads_publish' });
  const data = await res.json();
  if (!res.ok || !data.id) {
    return { ok: false, step: 'threads_publish', error: data?.error?.message || JSON.stringify(data) };
  }
  return { ok: true, postId: data.id as string };
}

async function pollContainerStatus(
  containerId: string,
  accessToken: string,
  maxAttempts = 18,
  intervalMs = 5000,
): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(intervalMs);
    try {
      const res = await fetchWithRetry({
        url: `${GRAPH_API_BASE}/${containerId}?fields=status&access_token=${encodeURIComponent(accessToken)}`,
        label: `poll_${containerId.slice(0, 8)}`,
      });
      const data = await res.json();
      const status = (data.status as string | undefined)?.toUpperCase();
      if (status === 'FINISHED') return { ok: true };
      if (status === 'ERROR' || status === 'EXPIRED') {
        return { ok: false, error: `컨테이너 상태 ${status}` };
      }
      // IN_PROGRESS → continue
    } catch {
      // transient → retry
    }
  }
  return { ok: false, error: `폴링 타임아웃 (${maxAttempts * intervalMs}ms)` };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 발행 전 quota 체크 — 250/24h rolling.
 * Threads 는 공식적으로 250 (IG 25 대비 넉넉).
 */
export async function checkThreadsPublishingLimit(
  threadsUserId: string,
  accessToken: string,
): Promise<{ quotaUsed: number; quotaLimit: number } | null> {
  try {
    const res = await fetchWithRetry({
      url: `${GRAPH_API_BASE}/${threadsUserId}/threads_publishing_limit?fields=quota_usage,config&access_token=${encodeURIComponent(accessToken)}`,
      label: 'quota_check',
    });
    const data = await res.json();
    const entry = Array.isArray(data?.data) ? data.data[0] : null;
    if (!entry) return null;
    return {
      quotaUsed: entry.quota_usage ?? 0,
      quotaLimit: entry.config?.quota_total ?? 250,
    };
  } catch {
    return null;
  }
}

export interface ReplyToThreadInput {
  threadsUserId: string;
  accessToken: string;
  postId: string;
  text: string;
}

/**
 * 발행된 Threads 포스트에 댓글 추가 (engagement velocity 향상).
 * Threads API: POST /{threadsUserId}/threads/{postId}/replies
 * 90초 rule: 첫 댓글을 90초 이내에 달면 알고리즘이 engagement velocity를 높게 평가
 */
export async function replyToThread(input: ReplyToThreadInput): Promise<{ ok: boolean; replyId?: string; error?: string }> {
  const { threadsUserId, accessToken, postId, text } = input;
  if (!text || text.trim().length === 0) return { ok: false, error: '댓글 본문 없음' };
  if (text.length > 500) return { ok: false, error: `댓글 500자 초과 (${text.length}자)` };

  try {
    const form = new URLSearchParams({
      text: text.slice(0, 500),
      access_token: accessToken,
    });
    const res = await fetchWithRetry({
      url: `${GRAPH_API_BASE}/${threadsUserId}/threads/${postId}/replies`,
      init: { method: 'POST', body: form },
      label: 'reply_to_thread',
    });
    const data = await res.json();
    if (!res.ok || !data.id) {
      return { ok: false, error: data?.error?.message || JSON.stringify(data) };
    }
    return { ok: true, replyId: data.id as string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
