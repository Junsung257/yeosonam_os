import { type NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { runUnmatchedClassification } from '@/lib/unmatched-classifier';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { countActiveUnmatched } from '@/lib/unmatched-lifecycle';

export const dynamic = 'force-dynamic';

const handleUnmatchedClassify = async (request: NextRequest) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  try {
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? process.env.UNMATCHED_CLASSIFY_LIMIT ?? 300);
    const minAttractionScore = Number(
      request.nextUrl.searchParams.get('min_attraction_score') ??
      process.env.UNMATCHED_CLASSIFY_ATTRACTION_SCORE ??
      95,
    );
    const result = await runUnmatchedClassification({ limit, minAttractionScore });
    return {
      ...result,
      active_pending_after: await countActiveUnmatched(),
    };
  } catch (error) {
    const message = sanitizeDbError(error, 'unmatched classify failed');
    return { ok: false, error: message, errors: [message] };
  }
};

export const GET = withCronLogging('unmatched-classify', handleUnmatchedClassify);
