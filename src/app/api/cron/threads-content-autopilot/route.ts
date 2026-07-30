import { type NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { runThreadsContentAutopilot } from '@/lib/threads-content-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function run(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return runThreadsContentAutopilot();
}

export const GET = withCronLogging('threads-content-autopilot', run);
