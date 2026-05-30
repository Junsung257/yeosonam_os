import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getMarketingAssetGroups } from '@/lib/marketing/asset-groups';
import { attachLedgerToActions, syncMarketingRecommendations } from '@/lib/marketing/recommendation-ledger';

export const dynamic = 'force-dynamic';

async function getHandler(request: NextRequest) {
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 50), 1), 100);
  const { groups, actions } = await getMarketingAssetGroups(limit);
  const ledger = await syncMarketingRecommendations(groups, actions);
  return NextResponse.json({
    checked_at: new Date().toISOString(),
    actions: attachLedgerToActions(actions, ledger),
  });
}

export const GET = withAdminGuard(getHandler);
