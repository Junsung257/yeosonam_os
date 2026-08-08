import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { deliverDueAffiliateNotifications } from '@/lib/affiliate/notification-outbox';
import { withCronGuard } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getHandler = async (_request: NextRequest) => {
  const result = await deliverDueAffiliateNotifications(20);
  return apiResponse({ ok: result.failed === 0, ...result, ran_at: new Date().toISOString() }, {
    status: result.failed > 0 ? 207 : 200,
  });
};

export const GET = withCronGuard(getHandler);

