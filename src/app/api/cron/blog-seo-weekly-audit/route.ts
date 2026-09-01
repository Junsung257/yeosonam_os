import { NextRequest } from 'next/server';

import { cronUnauthorizedResponse, isCronOrVercelAuthorized } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { runBlogSeoWeeklyAuditV4 } from '@/lib/blog-seo-weekly-audit-v4';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function run(request: NextRequest) {
  if (!isCronOrVercelAuthorized(request)) return cronUnauthorizedResponse();
  const scope = request.nextUrl.searchParams.get('scope');
  return runBlogSeoWeeklyAuditV4({
    scope: scope === 'shadow' || scope === 'manual' || scope === 'release' ? scope : 'weekly',
    forceKey: request.nextUrl.searchParams.get('forceKey') || undefined,
  });
}

export const GET = withCronLogging('blog-seo-weekly-audit', run, {
  handlerTimeoutMs: 285_000,
});
