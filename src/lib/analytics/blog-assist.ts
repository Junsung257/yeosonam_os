'use client';

const BLOG_ASSIST_ID_KEY = 'ys_last_content_creative_id';
const BLOG_ASSIST_TS_KEY = 'ys_last_content_creative_ts';
const BLOG_ASSIST_WINDOW_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function availableStores(): Storage[] {
  if (typeof window === 'undefined') return [];
  return [window.sessionStorage, window.localStorage];
}

export function rememberBlogAssist(contentCreativeId: string, now = Date.now()): void {
  if (!UUID_RE.test(contentCreativeId)) return;
  for (const storage of availableStores()) {
    try {
      storage.setItem(BLOG_ASSIST_ID_KEY, contentCreativeId);
      storage.setItem(BLOG_ASSIST_TS_KEY, String(now));
    } catch {
      // Storage can be unavailable in private browsing. Attribution is best effort.
    }
  }
}

export function readLastBlogAssist(now = Date.now()): string | null {
  for (const storage of availableStores()) {
    try {
      const id = storage.getItem(BLOG_ASSIST_ID_KEY);
      const capturedAt = Number(storage.getItem(BLOG_ASSIST_TS_KEY));
      if (!id || !UUID_RE.test(id) || !Number.isFinite(capturedAt)) continue;
      if (now - capturedAt <= BLOG_ASSIST_WINDOW_MS) return id;
      storage.removeItem(BLOG_ASSIST_ID_KEY);
      storage.removeItem(BLOG_ASSIST_TS_KEY);
    } catch {
      // Try the other storage implementation.
    }
  }
  return null;
}
