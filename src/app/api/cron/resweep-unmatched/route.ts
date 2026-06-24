import { type NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { logAndSanitize } from '@/lib/error-sanitizer';
import { resweepUnmatchedActivities } from '@/lib/unmatched-resweep';
import { countActiveUnmatched } from '@/lib/unmatched-lifecycle';

export const dynamic = 'force-dynamic';

async function runResweepUnmatchedCron() {
  const result = await resweepUnmatchedActivities();
  const { errors, ...summary } = result;
  return {
    ok: true,
    ...summary,
    active_pending_after: await countActiveUnmatched(),
    error_count: errors,
  };
}

const getHandler = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  try {
    return await runResweepUnmatchedCron();
  } catch (error) {
    const message = logAndSanitize('cron resweep-unmatched', error, 'sweep failed');
    return { ok: false, error: message, errors: [message] };
  }
};

export const GET = withCronLogging('resweep-unmatched', getHandler);
