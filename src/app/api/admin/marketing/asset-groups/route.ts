import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getMarketingAssetGroups } from '@/lib/marketing/asset-groups';
import { attachLedgerToActions, syncMarketingRecommendations } from '@/lib/marketing/recommendation-ledger';

export const dynamic = 'force-dynamic';

async function getHandler(request: NextRequest) {
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 30), 1), 100);
  const data = await getMarketingAssetGroups(limit);
  const ledger = await syncMarketingRecommendations(data.groups, data.actions);
  const actions = attachLedgerToActions(data.actions, ledger);
  const groups = data.groups.map((group) => ({
    ...group,
    next_actions: attachLedgerToActions(group.next_actions, ledger),
  }));
  return NextResponse.json({
    checked_at: new Date().toISOString(),
    groups,
    actions,
  });
}

export const GET = withAdminGuard(getHandler);
