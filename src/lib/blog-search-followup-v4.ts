import { supabaseAdmin } from './supabase';
import type { BlogIndexStatus } from './blog-visibility-snapshots';
import type { BlogSearchLifecycleStatus } from './blog-autopilot-v4-contract';

export const BLOG_SEARCH_FOLLOWUP_VERSION_V4 = 'blog-search-followup-v4.0.0' as const;
export const BLOG_SEARCH_FOLLOWUP_MILESTONES_V4 = [1, 3, 7] as const;
export type BlogSearchFollowupMilestoneV4 = typeof BLOG_SEARCH_FOLLOWUP_MILESTONES_V4[number];

export function buildBlogSearchFollowupRowsV4(input: {
  contentCreativeId: string;
  slug: string;
  url: string;
  publishedAt: Date;
}) {
  return BLOG_SEARCH_FOLLOWUP_MILESTONES_V4.map((milestoneDays) => {
    const dueAt = new Date(input.publishedAt.getTime() + milestoneDays * 86_400_000).toISOString();
    return {
      content_creative_id: input.contentCreativeId,
      slug: input.slug,
      url: input.url,
      milestone_days: milestoneDays,
      due_at: dueAt,
      next_attempt_at: dueAt,
      status: 'queued',
      attempt_count: 0,
      result: { version: BLOG_SEARCH_FOLLOWUP_VERSION_V4 },
    };
  });
}

export async function enqueueBlogSearchFollowupsV4(input: {
  contentCreativeId: string;
  slug: string;
  url: string;
  publishedAt?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = buildBlogSearchFollowupRowsV4({
    ...input,
    publishedAt: input.publishedAt ?? new Date(),
  });
  const { error } = await supabaseAdmin
    .from('blog_search_followup_jobs')
    .upsert(rows, { onConflict: 'content_creative_id,milestone_days', ignoreDuplicates: true });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export function decideBlogSearchFollowupV4(input: {
  milestoneDays: BlogSearchFollowupMilestoneV4;
  indexStatus: BlogIndexStatus;
  lifecycleStatus: BlogSearchLifecycleStatus;
  pageFetchState?: string | null;
  userCanonical?: string | null;
  inspectedUrl: string;
}) {
  const indexed = input.indexStatus === 'indexed' || input.lifecycleStatus === 'indexed' || input.lifecycleStatus === 'ranking';
  if (indexed) {
    return { outcome: 'completed' as const, resubmitSitemap: false, correctionType: null, reason: 'indexed_confirmed' };
  }
  if (input.milestoneDays === 3) {
    const discovered = ['discovered', 'crawled', 'indexed', 'ranking'].includes(input.lifecycleStatus);
    return {
      outcome: 'completed' as const,
      resubmitSitemap: !discovered,
      correctionType: null,
      reason: discovered ? 'discovered_not_indexed' : 'd3_not_discovered_sitemap_resubmit_once',
    };
  }
  if (input.milestoneDays === 7) {
    const fetchState = String(input.pageFetchState || '').toLowerCase();
    const canonicalMismatch = Boolean(input.userCanonical && input.userCanonical !== input.inspectedUrl);
    const technical = input.indexStatus === 'blocked'
      || canonicalMismatch
      || (fetchState.length > 0 && !/(?:successful|success|allowed)/.test(fetchState));
    return {
      outcome: 'escalated' as const,
      resubmitSitemap: false,
      correctionType: technical ? 'technical' as const : 'content' as const,
      reason: technical ? 'd7_not_indexed_technical_review' : 'd7_not_indexed_content_review',
    };
  }
  return { outcome: 'completed' as const, resubmitSitemap: false, correctionType: null, reason: 'd1_observation_recorded' };
}

export function nextBlogSearchFollowupRetryV4(attemptCount: number, now = new Date()) {
  const nextAttemptCount = Math.min(3, Math.max(0, Math.trunc(attemptCount)) + 1);
  const exhausted = nextAttemptCount >= 3;
  const delayMs = 60 * 60 * 1_000 * (2 ** Math.max(0, nextAttemptCount - 1));
  return {
    attemptCount: nextAttemptCount,
    status: exhausted ? 'failed' as const : 'retry' as const,
    nextAttemptAt: new Date(now.getTime() + delayMs).toISOString(),
  };
}
