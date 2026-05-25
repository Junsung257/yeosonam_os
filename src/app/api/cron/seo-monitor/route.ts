import { NextRequest } from 'next/server';
import { withCronLogging, CronSummary } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { runSeoMonitoring } from '@/lib/seo-monitor';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

async function handler(_req: NextRequest): Promise<CronSummary> {
  if (!isCronAuthorized(_req)) {
    const resp = cronUnauthorizedResponse();
    return { errors: [resp.statusText], status: 'unauthorized' };
  }

  const { snapshot, alerts } = await runSeoMonitoring();

  return {
    ok: true,
    hasSnapshot: !!snapshot,
    alertCount: alerts.length,
    alerts: alerts.map((a) => ({ type: a.type, severity: a.severity, title: a.title })),
  };
}

export const POST = withCronLogging('seo-monitor', handler);
export const GET = POST;
