import { type NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { dismissMarketingRecommendation } from '@/lib/marketing/recommendation-ledger';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

async function postHandler(request: NextRequest) {
  try {
    const body = await request.json();
    const actionId = typeof body?.action_id === 'string' ? body.action_id : '';
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;

    if (!actionId) {
      return apiResponse({ error: 'action_id is required' }, { status: 400 });
    }

    await dismissMarketingRecommendation(actionId, reason);
    return apiResponse({
      dismissed_at: new Date().toISOString(),
      action_id: actionId,
    });
  } catch (err) {
    const message = sanitizeDbError(err, 'Failed to dismiss marketing action');
    const status = message.includes('migration is not applied yet') ? 503 : 500;
    return apiResponse(
      { error: message },
      { status },
    );
  }
}

export const POST = withAdminGuard(postHandler);
