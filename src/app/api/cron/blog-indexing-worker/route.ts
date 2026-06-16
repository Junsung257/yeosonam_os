import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { processDueBlogIndexingJobs } from '@/lib/blog-indexing-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function runBlogIndexingWorker(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return processDueBlogIndexingJobs({ workerName: 'blog-indexing-worker' });
}

export const GET = withCronLogging('blog-indexing-worker', runBlogIndexingWorker);
