/**
 * GET /api/cron/publish-scheduled
 *
 * Runs every 15 minutes from Vercel Cron.
 *
 * Handles:
 * - content_distributions where status='scheduled' and scheduled_for <= now()
 * - legacy card_news Instagram carousel queue rows
 */
import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import {
  checkPublishingLimit,
  getInstagramConfig,
  publishCarouselToInstagram,
} from '@/lib/instagram-publisher';
import {
  publishDistribution,
  type DistributionPublishResult,
  type ScheduledDistributionRow,
} from '@/lib/social-publishing/distribution-publisher';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { maybeSkipNonCriticalCron } from '@/lib/cron-resource-saver';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export type ScheduledRow = ScheduledDistributionRow;

interface PublishScheduledSummary {
  picked: number;
  published: number;
  failed: number;
  skipped: number;
  errors: string[];
  details: Array<{ id: string; platform: string; status: string; error?: string }>;
  ig_card_news: {
    picked: number;
    published: number;
    failed: number;
    skipped: number;
    quota_used: number | null;
    quota_limit: number | null;
  };
}

async function runPublishScheduled(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  const resourceSaver = maybeSkipNonCriticalCron(request, 'publish-scheduled');
  if (resourceSaver) return resourceSaver;

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB not configured' }, { status: 503 });
  }

  const startedAt = Date.now();
  const summary: PublishScheduledSummary = {
    picked: 0,
    published: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    details: [],
    ig_card_news: {
      picked: 0,
      published: 0,
      failed: 0,
      skipped: 0,
      quota_used: null,
      quota_limit: null,
    },
  };

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('content_distributions')
      .select('id, product_id, card_news_id, blog_post_id, platform, payload, scheduled_for, engagement, tenant_id, retry_count, max_retries')
      .eq('status', 'scheduled')
      .lte('scheduled_for', nowIso)
      .order('scheduled_for', { ascending: true })
      .limit(20);

    if (error) throw error;

    const rows = (data ?? []) as ScheduledRow[];
    summary.picked = rows.length;

    for (const row of rows) {
      try {
        const result = await publishDistribution(row, { skipStatusUpdate: true });
        await persistPublishResult(row, result);

        if (result.status === 'published') {
          summary.published += 1;
          summary.details.push({ id: row.id, platform: row.platform, status: 'published' });
        } else if (result.status === 'skipped') {
          summary.skipped += 1;
          summary.details.push({ id: row.id, platform: row.platform, status: 'skipped', error: result.reason });
        } else {
          const retryCount = (row.retry_count ?? 0) + 1;
          const maxRetries = row.max_retries ?? 3;
          const newStatus = retryCount >= maxRetries ? 'failed' : 'scheduled';
          summary.failed += 1;
          summary.errors.push(`${row.id} (${row.platform}): ${result.error}`);
          summary.details.push({ id: row.id, platform: row.platform, status: newStatus, error: result.error });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`${row.id} fatal: ${msg}`);
      }
    }
  } catch (err) {
    summary.errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await processQueuedCardNewsIG(summary);
  } catch (err) {
    summary.errors.push(`ig_card_news fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log('[publish-scheduled]', JSON.stringify({ ...summary, elapsed_ms: elapsedMs }));
  return { ...summary, elapsed_ms: elapsedMs };
}

async function persistPublishResult(
  row: ScheduledRow,
  result: DistributionPublishResult,
): Promise<void> {
  const engagement = {
    ...(row.engagement ?? {}),
    ...(typeof result.predicted_er === 'number' ? { predicted_er: result.predicted_er } : {}),
  };

  if (result.status === 'published') {
    await supabaseAdmin
      .from('content_distributions')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        external_id: result.external_id ?? null,
        external_url: result.external_url ?? null,
        retry_count: 0,
        error_message: null,
        engagement,
      })
      .eq('id', row.id);
    return;
  }

  if (result.status === 'skipped') {
    await supabaseAdmin
      .from('content_distributions')
      .update({
        error_message: result.reason ?? 'Skipped',
        engagement,
      })
      .eq('id', row.id);
    return;
  }

  const retryCount = (row.retry_count ?? 0) + 1;
  const maxRetries = row.max_retries ?? 3;
  const retry = retryCount < maxRetries;

  await supabaseAdmin
    .from('content_distributions')
    .update({
      status: retry ? 'scheduled' : 'failed',
      retry_count: retryCount,
      error_message: result.error ?? 'Publish failed',
      engagement: {
        ...engagement,
        last_error: result.error ?? 'Publish failed',
      },
      ...(retry ? { scheduled_for: new Date(Date.now() + 30 * 60 * 1000).toISOString() } : {}),
    })
    .eq('id', row.id);
}

interface QueuedCardNewsRow {
  id: string;
  slides: unknown;
  ig_caption: string | null;
  ig_slide_urls: string[] | null;
  ig_scheduled_for: string;
  ig_error: string | null;
}

async function processQueuedCardNewsIG(summary: PublishScheduledSummary): Promise<void> {
  const cfg = await getInstagramConfig();
  if (!cfg) {
    console.log('[publish-scheduled] Instagram config missing; skipping legacy card_news queue');
    return;
  }

  const nowIso = new Date().toISOString();
  const perCronLimit = 3;
  const { data, error } = await supabaseAdmin
    .from('card_news')
    .select('id, slides, ig_caption, ig_slide_urls, ig_scheduled_for, ig_error')
    .eq('ig_publish_status', 'queued')
    .lte('ig_scheduled_for', nowIso)
    .order('ig_scheduled_for', { ascending: true })
    .limit(perCronLimit);

  if (error) {
    summary.errors.push(`ig_card_news query: ${error.message}`);
    return;
  }

  const rows = (data ?? []) as QueuedCardNewsRow[];
  summary.ig_card_news.picked = rows.length;
  if (rows.length === 0) return;

  const quota = await checkPublishingLimit(cfg.igUserId, cfg.accessToken);
  if (quota) {
    summary.ig_card_news.quota_used = quota.quotaUsed;
    summary.ig_card_news.quota_limit = quota.quotaLimit;
  }

  const remaining = quota ? Math.max(0, quota.quotaLimit - quota.quotaUsed) : rows.length;
  const processable = rows.slice(0, remaining);
  const deferred = rows.length - processable.length;
  if (deferred > 0) {
    summary.ig_card_news.skipped += deferred;
  }

  for (const row of processable) {
    const caption = (row.ig_caption ?? '').trim();
    const urls = Array.isArray(row.ig_slide_urls)
      ? row.ig_slide_urls.filter((url) => typeof url === 'string' && url.length > 0)
      : [];

    if (!caption) {
      await markCardNewsIgFailed(row.id, 'ig_caption is empty', 2);
      summary.ig_card_news.failed += 1;
      continue;
    }

    if (urls.length < 2 || urls.length > 10) {
      await markCardNewsIgFailed(row.id, `image count ${urls.length}; expected 2-10`, 2);
      summary.ig_card_news.failed += 1;
      continue;
    }

    const nonPublic = urls.find((url) => !url.startsWith('http://') && !url.startsWith('https://'));
    if (nonPublic) {
      await markCardNewsIgFailed(row.id, 'image URL is not public http(s)', 2);
      summary.ig_card_news.failed += 1;
      continue;
    }

    await supabaseAdmin
      .from('card_news')
      .update({ ig_publish_status: 'publishing', ig_error: null })
      .eq('id', row.id);

    try {
      const result = await publishCarouselToInstagram({
        igUserId: cfg.igUserId,
        accessToken: cfg.accessToken,
        imageUrls: urls,
        caption,
      });

      if (result.ok) {
        await supabaseAdmin
          .from('card_news')
          .update({
            ig_publish_status: 'published',
            ig_post_id: result.postId,
            ig_published_at: new Date().toISOString(),
            ig_error: null,
          })
          .eq('id', row.id);
        summary.ig_card_news.published += 1;
        continue;
      }

      const nextAttempt = parseAttemptCount(row.ig_error) + 1;
      const failed = nextAttempt >= 2;
      await markCardNewsIgFailed(
        row.id,
        `[${result.step}] ${result.error}`,
        nextAttempt,
        failed ? undefined : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      );
      if (failed) summary.ig_card_news.failed += 1;
      else summary.ig_card_news.skipped += 1;
    } catch (err) {
      const nextAttempt = parseAttemptCount(row.ig_error) + 1;
      const failed = nextAttempt >= 2;
      await markCardNewsIgFailed(
        row.id,
        `unexpected: ${err instanceof Error ? err.message : String(err)}`,
        nextAttempt,
        failed ? undefined : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      );
      if (failed) summary.ig_card_news.failed += 1;
      else summary.ig_card_news.skipped += 1;
    }
  }
}

function parseAttemptCount(igError: string | null | undefined): number {
  if (!igError) return 0;
  const match = igError.match(/^\[attempt:(\d+)\]/);
  return match ? parseInt(match[1], 10) : 0;
}

async function markCardNewsIgFailed(
  cardNewsId: string,
  errorMessage: string,
  attempt: number,
  retryAt?: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    ig_error: `[attempt:${attempt}] ${errorMessage}`,
  };

  if (retryAt) {
    patch.ig_publish_status = 'queued';
    patch.ig_scheduled_for = retryAt;
  } else {
    patch.ig_publish_status = 'failed';
  }

  try {
    await supabaseAdmin.from('card_news').update(patch).eq('id', cardNewsId);
  } catch (err) {
    console.error('[publish-scheduled] markCardNewsIgFailed DB error:', cardNewsId, err);
  }
}

export const GET = withCronLogging('publish-scheduled', runPublishScheduled);
