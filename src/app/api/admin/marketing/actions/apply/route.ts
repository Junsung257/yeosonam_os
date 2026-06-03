import { type NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { applyMarketingAction } from '@/lib/marketing/action-runner';

export const dynamic = 'force-dynamic';

async function postHandler(request: NextRequest) {
  try {
    const body = await request.json();
    const actionId = typeof body?.action_id === 'string' ? body.action_id : '';
    const dryRun = body?.dry_run !== false;

    if (!actionId) {
      return apiResponse({ error: 'action_id is required' }, { status: 400 });
    }

    const plan = await applyMarketingAction(actionId, dryRun);
    return apiResponse({
      applied_at: new Date().toISOString(),
      plan,
    });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, 'Failed to apply marketing action') },
      { status: 500 },
    );
  }
}

export const POST = withAdminGuard(postHandler);
