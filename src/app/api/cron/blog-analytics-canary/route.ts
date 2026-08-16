import { NextRequest } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { recordServerAnalyticsEvent } from '@/lib/analytics/server-events';
import { supabaseAdmin } from '@/lib/supabase';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function kstDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

async function runBlogAnalyticsCanary(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  const day = kstDay();
  const idempotencyKey = `blog-analytics-canary:${day}`;
  const errors: string[] = [];
  try {
    const recorded = await recordServerAnalyticsEvent({
      eventName: 'generate_lead',
      idempotencyKey,
      sourceType: 'lead',
      sourceId: `blog-analytics-canary-${day}`,
      payload: { pipeline: 'blog_search_to_consultation', canary_day_kst: day },
      synthetic: true,
    });
    const [stored, delivery] = await Promise.all([
      supabaseAdmin.from('analytics_server_events')
        .select('id,event_payload,occurred_at')
        .eq('id', recorded.id)
        .contains('event_payload', { __synthetic: true })
        .maybeSingle(),
      supabaseAdmin.from('analytics_delivery_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('server_event_id', recorded.id),
    ]);
    if (stored.error || !stored.data?.id) {
      errors.push(`synthetic_event_readback_failed:${sanitizeDbError(stored.error || 'row_missing')}`);
    }
    if (delivery.error) {
      errors.push(`synthetic_delivery_probe_failed:${sanitizeDbError(delivery.error)}`);
    } else if (Number(delivery.count || 0) !== 0) {
      errors.push(`synthetic_event_delivery_leak:${delivery.count}`);
    }
    return {
      ok: errors.length === 0,
      day_kst: day,
      event_id: recorded.id,
      idempotent: recorded.idempotent,
      stored: Boolean(stored.data?.id),
      external_delivery_jobs: delivery.error ? null : Number(delivery.count || 0),
      errors,
    };
  } catch (error) {
    errors.push(`synthetic_event_write_failed:${sanitizeDbError(error)}`);
    return { ok: false, day_kst: day, stored: false, errors };
  }
}

export const GET = withCronLogging('blog-analytics-canary', runBlogAnalyticsCanary, {
  handlerTimeoutMs: 45_000,
  sideEffectTimeoutMs: 5_000,
});
