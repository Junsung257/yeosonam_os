import { NextRequest } from 'next/server';
import { assignPublishSlots, getBlogPublishingPolicy, normalizeDailyPostTarget, refillWeeklyQueue } from '@/lib/blog-scheduler';
import { ensureAllDestinationsHavePillar } from '@/lib/blog-pillar-generator';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { logError } from '@/lib/sentry-logger';
import { isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const handleSchedule = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase not configured', errors: [] as string[] };
  }

  try {
    const policy = await getBlogPublishingPolicy('global');
    const postsPerDay = normalizeDailyPostTarget(policy.posts_per_day);
    const pillarResult = await ensureAllDestinationsHavePillar();
    const result = await refillWeeklyQueue({ postsPerDay });
    const slotAssignment = await assignPublishSlots(postsPerDay);

    return {
      ok: true,
      postsPerDay,
      pillars: pillarResult,
      refill: result,
      slot_assignment: slotAssignment,
      ranAt: new Date().toISOString(),
    };
  } catch (err) {
    logError('[cron/blog-scheduler] scheduler failed', err);
    const msg = sanitizeDbError(err, 'blog scheduler failed');
    return { ok: false, error: msg, errors: [msg] };
  }
};

export const GET = withCronLogging('blog-scheduler', handleSchedule, {
  handlerTimeoutMs: 285_000,
  sideEffectTimeoutMs: 5_000,
});
