import { NextRequest } from 'next/server';
import { DEFAULT_POSTS_PER_DAY, assignPublishSlots, refillWeeklyQueue } from '@/lib/blog-scheduler';
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
    const pillarResult = await ensureAllDestinationsHavePillar();
    const result = await refillWeeklyQueue({ postsPerDay: DEFAULT_POSTS_PER_DAY });
    const slotAssignment = await assignPublishSlots(DEFAULT_POSTS_PER_DAY);

    return {
      ok: true,
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
