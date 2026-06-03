import { type NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getMarketingAssetGroups } from '@/lib/marketing/asset-groups';
import { attachLedgerToActions, syncMarketingRecommendations } from '@/lib/marketing/recommendation-ledger';

export const dynamic = 'force-dynamic';

async function getHandler(request: NextRequest) {
  try {
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 50), 1), 100);
    const { groups, actions } = await getMarketingAssetGroups(limit);
    const ledger = await syncMarketingRecommendations(groups, actions);
    return apiResponse({
      checked_at: new Date().toISOString(),
      actions: attachLedgerToActions(actions, ledger),
    });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, 'Failed to load marketing actions') },
      { status: 500 },
    );
  }
}

export const GET = withAdminGuard(getHandler);
