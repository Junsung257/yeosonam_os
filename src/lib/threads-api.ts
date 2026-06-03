const GRAPH_API_BASE = 'https://graph.threads.net/v1.0';

export type ThreadsApiErrorCategory =
  | 'identity_or_permission_mismatch'
  | 'rate_limited'
  | 'token_invalid'
  | 'not_found'
  | 'unknown';

export interface ThreadsIdentityProbe {
  ok: boolean;
  id?: string;
  username?: string;
  error?: string;
  errorCategory?: ThreadsApiErrorCategory;
}

export interface ThreadsPostVerification {
  verified: boolean;
  postId: string;
  permalink?: string;
  timestamp?: string;
  verificationError?: string;
  errorCategory?: ThreadsApiErrorCategory;
}

export interface ThreadsMetrics {
  views?: number;
  likes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  raw?: unknown;
}

export interface ThreadsInsightsResult {
  ok: boolean;
  metrics?: ThreadsMetrics;
  score?: number;
  error?: string;
  errorCategory?: ThreadsApiErrorCategory;
  raw?: unknown;
}

export async function probeThreadsIdentity(accessToken: string): Promise<ThreadsIdentityProbe> {
  try {
    const url = `${GRAPH_API_BASE}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: extractThreadsErrorMessage(data),
        errorCategory: classifyThreadsApiError(data),
      };
    }
    return {
      ok: true,
      id: typeof data.id === 'string' ? data.id : undefined,
      username: typeof data.username === 'string' ? data.username : undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), errorCategory: 'unknown' };
  }
}

export async function verifyThreadsPostOwnership(
  postId: string,
  accessToken: string,
): Promise<ThreadsPostVerification> {
  const direct = await fetchThreadsPostFields(postId, accessToken);
  if (direct.verified) return direct;

  try {
    const url = `${GRAPH_API_BASE}/me/threads?fields=id,permalink,timestamp&limit=25&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      return {
        verified: false,
        postId,
        verificationError: extractThreadsErrorMessage(data) || direct.verificationError,
        errorCategory: classifyThreadsApiError(data),
      };
    }
    const posts = Array.isArray(data.data) ? data.data as Array<Record<string, unknown>> : [];
    const match = posts.find((row) => row.id === postId);
    if (!match) {
      return {
        verified: false,
        postId,
        verificationError: direct.verificationError ?? 'Post was not found in /me/threads for the configured token.',
        errorCategory: direct.errorCategory ?? 'identity_or_permission_mismatch',
      };
    }
    return {
      verified: true,
      postId,
      permalink: typeof match.permalink === 'string' ? match.permalink : undefined,
      timestamp: typeof match.timestamp === 'string' ? match.timestamp : undefined,
    };
  } catch (err) {
    return {
      verified: false,
      postId,
      verificationError: err instanceof Error ? err.message : String(err),
      errorCategory: 'unknown',
    };
  }
}

export async function fetchThreadsInsights(
  mediaId: string,
  accessToken: string,
): Promise<ThreadsInsightsResult> {
  try {
    const metricList = ['views', 'likes', 'replies', 'reposts', 'quotes'].join(',');
    const url = `${GRAPH_API_BASE}/${mediaId}/insights?metric=${metricList}&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        error: extractThreadsErrorMessage(data),
        errorCategory: classifyThreadsApiError(data),
        raw: data,
      };
    }
    const entries = (data.data ?? []) as Array<{ name: string; values: Array<{ value: number }> }>;
    const get = (name: string) => entries.find(e => e.name === name)?.values?.[0]?.value ?? null;
    const metrics: ThreadsMetrics = {
      views: get('views') ?? undefined,
      likes: get('likes') ?? undefined,
      replies: get('replies') ?? undefined,
      reposts: get('reposts') ?? undefined,
      quotes: get('quotes') ?? undefined,
      raw: data,
    };
    return { ok: true, metrics, score: computeThreadsScore(metrics), raw: data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      errorCategory: 'unknown',
    };
  }
}

export function computeThreadsScore(m: ThreadsMetrics): number {
  const denom = (m.views ?? 1) || 1;
  const numer = (m.reposts ?? 0) * 5 + (m.quotes ?? 0) * 3 + (m.replies ?? 0) * 2 + (m.likes ?? 0);
  return Math.min(1, numer / denom);
}

function fetchThreadsPostFields(postId: string, accessToken: string): Promise<ThreadsPostVerification> {
  return fetch(`${GRAPH_API_BASE}/${postId}?fields=id,permalink,timestamp&access_token=${encodeURIComponent(accessToken)}`)
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        return {
          verified: false,
          postId,
          verificationError: extractThreadsErrorMessage(data),
          errorCategory: classifyThreadsApiError(data),
        };
      }
      return {
        verified: data.id === postId,
        postId,
        permalink: typeof data.permalink === 'string' ? data.permalink : undefined,
        timestamp: typeof data.timestamp === 'string' ? data.timestamp : undefined,
        verificationError: data.id === postId ? undefined : 'Post id mismatch from direct lookup.',
      };
    })
    .catch((err) => ({
      verified: false,
      postId,
      verificationError: err instanceof Error ? err.message : String(err),
      errorCategory: 'unknown',
    }));
}

function extractThreadsErrorMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const error = (data as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : JSON.stringify(data);
}

function classifyThreadsApiError(data: unknown): ThreadsApiErrorCategory {
  const error = data && typeof data === 'object' ? (data as { error?: Record<string, unknown> }).error : undefined;
  const code = Number(error?.code);
  const subcode = Number(error?.error_subcode);
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';

  if (code === 100 && subcode === 33) return 'identity_or_permission_mismatch';
  if (code === 10 || message.includes('permission')) return 'identity_or_permission_mismatch';
  if (code === 190 || message.includes('token')) return 'token_invalid';
  if (code === 4 || code === 17 || message.includes('rate limit')) return 'rate_limited';
  if (message.includes('does not exist') || message.includes('not found')) return 'not_found';
  return 'unknown';
}
