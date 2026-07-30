import { type NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { runThreadsEngagement } from '@/lib/threads-engagement/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function run(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return runThreadsEngagement();
}

export const GET = withCronLogging('threads-engagement', run);
