import { type NextRequest } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { withCronLogging } from '@/lib/cron-observability';
import { captureMarketingAssetGroupSnapshots } from '@/lib/marketing/asset-group-snapshots';

export const runtime = 'nodejs';
export const maxDuration = 180;
export const dynamic = 'force-dynamic';

async function runMarketingAssetSnapshot(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 100), 1), 300);
  return captureMarketingAssetGroupSnapshots(limit);
}

export const GET = withCronLogging('marketing-asset-snapshot', runMarketingAssetSnapshot);
