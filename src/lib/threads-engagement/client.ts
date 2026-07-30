import type {
  ThreadsConversationItem,
  ThreadsCredentials,
  ThreadsInboxItem,
  ThreadsPostSummary,
  ThreadsPublishedReply,
} from './types';

const GRAPH_API_BASE = 'https://graph.threads.net/v1.0';
const REQUEST_TIMEOUT_MS = 15_000;
const REPLY_FIELDS =
  'id,text,username,timestamp,permalink,replied_to,has_replies,is_reply,is_reply_owned_by_me';

type FetchLike = typeof fetch;

export class ThreadsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
    this.name = 'ThreadsApiError';
  }
}

function compactProviderMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240) || 'empty response';
}

function toPathId(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error('Threads object id must be numeric');
  return value;
}

export class ThreadsEngagementClient {
  constructor(
    private readonly credentials: ThreadsCredentials,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly wait: (ms: number) => Promise<void> =
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${GRAPH_API_BASE}${path}`);
    const init: RequestInit = {
      method,
      headers: { Authorization: `Bearer ${this.credentials.accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (method === 'GET') {
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    } else {
      init.body = new URLSearchParams(params);
      init.headers = {
        ...init.headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      };
    }

    const response = await this.fetchImpl(url, init);
    const raw = await response.text();
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const providerError = (
        body as {
          error?: { message?: string; code?: number; error_subcode?: number };
        } | null
      )?.error;
      throw new ThreadsApiError(
        providerError?.message
          ? `Threads API: ${compactProviderMessage(providerError.message)}`
          : `Threads API HTTP ${response.status}: ${compactProviderMessage(raw)}`,
        response.status,
        providerError?.code,
        providerError?.error_subcode,
      );
    }
    if (!body || typeof body !== 'object') {
      throw new ThreadsApiError(
        `Threads API returned an invalid response for ${path}`,
        response.status,
      );
    }
    return body as T;
  }

  async getProfile(): Promise<{ id: string; username: string }> {
    const data = await this.request<{ id?: string; username?: string }>('GET', '/me', {
      fields: 'id,username',
    });
    if (!data.id || !data.username) throw new Error('Threads profile response is incomplete');
    return { id: data.id, username: data.username };
  }

  async fetchRecentPosts(limit = 25): Promise<ThreadsPostSummary[]> {
    const bounded = Math.max(1, Math.min(50, Math.floor(limit)));
    const data = await this.request<{
      data?: Array<{
        id?: string;
        text?: string;
        username?: string;
        timestamp?: string;
        permalink?: string;
        is_reply?: boolean;
      }>;
    }>('GET', '/me/threads', {
      fields: 'id,text,username,timestamp,permalink,is_reply',
      limit: String(bounded),
    });

    return (data.data ?? [])
      .filter((row) => row.id && row.is_reply !== true)
      .map((row) => ({
        id: row.id!,
        text: row.text?.trim() ?? '',
        username: row.username?.trim() ?? '',
        timestamp: row.timestamp ?? '',
        permalink: row.permalink,
        isReply: row.is_reply,
      }));
  }

  private async fetchReplyEdge(
    objectId: string,
    edge: 'conversation' | 'replies',
    maxPages = 3,
  ): Promise<ThreadsConversationItem[]> {
    const id = toPathId(objectId);
    const rows: ThreadsConversationItem[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const data = await this.request<{
        data?: Array<{
          id?: string;
          text?: string;
          username?: string;
          timestamp?: string;
          permalink?: string;
          replied_to?: { id?: string };
          has_replies?: boolean;
          is_reply_owned_by_me?: boolean;
        }>;
        paging?: { cursors?: { after?: string } };
      }>('GET', `/${id}/${edge}`, {
        fields: REPLY_FIELDS,
        limit: '100',
        reverse: 'false',
        ...(after ? { after } : {}),
      });

      const batch = data.data ?? [];
      for (const row of batch) {
        if (!row.id) continue;
        rows.push({
          id: row.id,
          text: row.text?.trim() ?? '',
          username: row.username?.trim() ?? '',
          timestamp: row.timestamp ?? '',
          permalink: row.permalink,
          repliedToId: row.replied_to?.id,
          hasReplies: row.has_replies,
          isOwnedByMe: row.is_reply_owned_by_me,
        });
      }
      const nextAfter = data.paging?.cursors?.after;
      if (!nextAfter || nextAfter === after || batch.length === 0) break;
      after = nextAfter;
    }
    return rows;
  }

  async fetchConversation(rootPostId: string): Promise<ThreadsConversationItem[]> {
    try {
      return await this.fetchReplyEdge(rootPostId, 'conversation', 3);
    } catch (error) {
      if (error instanceof ThreadsApiError && [400, 403, 404].includes(error.status)) {
        return this.fetchReplyTree(rootPostId);
      }
      throw error;
    }
  }

  private async fetchReplyTree(rootPostId: string): Promise<ThreadsConversationItem[]> {
    const topLevel = await this.fetchReplyEdge(rootPostId, 'replies', 3);
    const all = [...topLevel];
    const seen = new Set(all.map((row) => row.id));
    const queue = [...topLevel];
    let expansionBudget = 30;

    while (queue.length > 0 && expansionBudget > 0) {
      const parent = queue.shift()!;
      if (parent.hasReplies === false) continue;
      expansionBudget -= 1;
      try {
        const children = await this.fetchReplyEdge(parent.id, 'replies', 2);
        for (const child of children) {
          if (seen.has(child.id)) continue;
          seen.add(child.id);
          all.push(child);
          queue.push(child);
        }
      } catch {
        // A single deleted/private child must not block the rest of the inbox.
      }
    }
    return all;
  }

  async fetchMentions(limit = 50): Promise<ThreadsInboxItem[]> {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows: ThreadsInboxItem[] = [];
    let after: string | undefined;

    while (rows.length < bounded) {
      const pageLimit = Math.min(50, bounded - rows.length);
      const data = await this.request<{
        data?: Array<{
          id?: string;
          text?: string;
          username?: string;
          timestamp?: string;
          permalink?: string;
        }>;
        paging?: { cursors?: { after?: string } };
      }>('GET', '/me/mentions', {
        fields: 'id,text,username,timestamp,permalink',
        limit: String(pageLimit),
        ...(after ? { after } : {}),
      });
      const batch = (data.data ?? [])
        .filter((row) => row.id && row.text?.trim())
        .map((row) => ({
          id: row.id!,
          kind: 'mention' as const,
          text: row.text!.trim(),
          username: row.username?.trim() ?? '',
          timestamp: row.timestamp ?? '',
          permalink: row.permalink,
        }));
      rows.push(...batch);
      const nextAfter = data.paging?.cursors?.after;
      if (!nextAfter || nextAfter === after || (data.data ?? []).length === 0) break;
      after = nextAfter;
    }

    return rows.slice(0, bounded);
  }

  async isDirectlyAnsweredByMe(objectId: string, myUsername: string): Promise<boolean> {
    const replies = await this.fetchReplyEdge(objectId, 'replies', 1);
    const expected = myUsername.trim().toLowerCase();
    return replies.some(
      (reply) =>
        reply.isOwnedByMe === true ||
        (expected.length > 0 && reply.username.toLowerCase() === expected),
    );
  }

  async publishReply(text: string, replyToId: string): Promise<ThreadsPublishedReply> {
    const targetId = toPathId(replyToId);
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 500) {
      throw new Error('Threads reply text must contain 1 to 500 characters');
    }

    const created = await this.request<{ id?: string }>('POST', '/me/threads', {
      media_type: 'TEXT',
      text: trimmed,
      reply_to_id: targetId,
    });
    if (!created.id) throw new Error('Threads reply container id is missing');

    await this.wait(1_500);
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const published = await this.request<{ id?: string }>('POST', '/me/threads_publish', {
          creation_id: created.id,
        });
        if (!published.id) throw new Error('Threads published reply id is missing');
        let permalink: string | undefined;
        try {
          const media = await this.request<{ permalink?: string }>(
            'GET',
            `/${toPathId(published.id)}`,
            { fields: 'permalink' },
          );
          permalink = media.permalink;
        } catch {
          // The provider id is authoritative; permalink lookup is best-effort.
        }
        return { id: published.id, permalink };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (
          attempt === 4 ||
          !/not ready|not found|not finished|try again|temporar|does not exist|in progress|processing/i.test(
            message,
          )
        ) {
          throw error;
        }
        await this.wait(2_000 + attempt * 1_000);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Threads reply publish failed');
  }
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function findUnansweredReplies(
  rootPost: ThreadsPostSummary,
  conversation: ThreadsConversationItem[],
  myUsername: string,
  maxPerPost = 20,
): ThreadsInboxItem[] {
  const me = myUsername.trim().toLowerCase();
  const answeredIds = new Set<string>();
  for (const item of conversation) {
    if (
      item.repliedToId &&
      (item.isOwnedByMe === true || (me.length > 0 && item.username.toLowerCase() === me))
    ) {
      answeredIds.add(item.repliedToId);
    }
  }

  return conversation
    .filter((item) => {
      if (!item.id || item.id === rootPost.id || !item.text.trim()) return false;
      if (item.isOwnedByMe === true) return false;
      if (me.length > 0 && item.username.toLowerCase() === me) return false;
      return !answeredIds.has(item.id);
    })
    .sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp))
    .slice(0, Math.max(1, Math.min(20, maxPerPost)))
    .map((item) => ({
      id: item.id,
      kind: 'reply' as const,
      text: item.text,
      username: item.username,
      timestamp: item.timestamp,
      rootPostId: rootPost.id,
      rootPostText: rootPost.text,
      permalink: item.permalink,
    }));
}
