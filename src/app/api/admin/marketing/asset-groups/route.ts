import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getMarketingAssetGroups } from '@/lib/marketing/asset-groups';
import { attachLedgerToActions, syncMarketingRecommendations } from '@/lib/marketing/recommendation-ledger';
import { withTimeout } from '@/lib/promise-timeout';

export const dynamic = 'force-dynamic';
const ASSET_GROUP_TIMEOUT_MS = 8000;

async function getHandler(request: NextRequest) {
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 30), 1), 100);
  try {
    const data = await withTimeout(
      getMarketingAssetGroups(limit),
      ASSET_GROUP_TIMEOUT_MS,
      'marketing asset groups',
    );
    const ledger = await withTimeout(
      syncMarketingRecommendations(data.groups, data.actions),
      ASSET_GROUP_TIMEOUT_MS,
      'marketing recommendation ledger',
    );
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Marketing asset groups unavailable';
    console.warn('[marketing/asset-groups] degraded response:', message);
    return NextResponse.json(
      {
        checked_at: new Date().toISOString(),
        groups: [],
        actions: [],
        degraded: true,
        error: message,
      },
      { status: 503 },
    );
  }
}

export const GET = withAdminGuard(getHandler);
