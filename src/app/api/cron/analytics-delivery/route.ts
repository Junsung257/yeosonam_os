import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withCronGuard } from '@/lib/cron-auth';
import { processGa4DeliveryJobs } from '@/lib/analytics/server-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const handler = async (_request: NextRequest) => {
  try {
    const result = await processGa4DeliveryJobs(20);
    return apiResponse({ ok: true, ...result });
  } catch (error) {
    console.error('[analytics-delivery] failed', error);
    return apiResponse(
      { ok: false, error: 'analytics delivery failed' },
      { status: 500 },
    );
  }
};

export const GET = withCronGuard(handler);
