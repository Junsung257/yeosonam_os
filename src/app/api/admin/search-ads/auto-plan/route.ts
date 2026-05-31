import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import {
  buildAndSaveSearchAdPackagePlan,
  buildSearchAdPackagePlan,
  listSearchAdKeywordPlans,
  updateSearchAdKeywordPlanStatus,
  type TravelPackageForSearchAds,
} from '@/lib/search-ads-auto-planner';

export const dynamic = 'force-dynamic';

type AutoPlanBody = {
  package_id?: string;
  package?: TravelPackageForSearchAds;
  save?: boolean;
  action?: 'create' | 'approve' | 'archive';
  ids?: string[];
};

export const GET = withAdminGuard(async (request: NextRequest): Promise<NextResponse> => {
  const { searchParams } = request.nextUrl;
  const packageId = searchParams.get('package_id') || undefined;
  const status = searchParams.get('status') || undefined;
  const limit = Number(searchParams.get('limit') || 120);
  const plans = await listSearchAdKeywordPlans({
    packageId,
    statuses: status && status !== 'all' ? status.split(',') as never : undefined,
    limit,
  });

  const summary = plans.reduce(
    (acc, row) => {
      acc.total += 1;
      acc.byStatus[row.plan_status] = (acc.byStatus[row.plan_status] ?? 0) + 1;
      acc.byPlatform[row.platform] = (acc.byPlatform[row.platform] ?? 0) + 1;
      acc.estimatedDailyBudget += Math.round(
        (Number(row.suggested_bid_krw || 0) * Number(row.daily_budget_share_pct || 0)) / 100,
      );
      return acc;
    },
    {
      total: 0,
      byStatus: {} as Record<string, number>,
      byPlatform: {} as Record<string, number>,
      estimatedDailyBudget: 0,
    },
  );

  return NextResponse.json({ ok: true, plans, summary });
});

const handler = async (request: NextRequest): Promise<NextResponse> => {
  const body = (await request.json().catch(() => ({}))) as AutoPlanBody;

  if (body.action === 'approve' || body.action === 'archive') {
    const status = body.action === 'approve' ? 'approved' : 'archived';
    const result = await updateSearchAdKeywordPlanStatus(body.ids ?? [], status);
    return NextResponse.json({ ok: true, ...result });
  }

  if (body.package_id) {
    const plan = await buildAndSaveSearchAdPackagePlan(body.package_id);
    return NextResponse.json({ ok: true, saved: plan.saved, plan });
  }

  if (body.package?.id) {
    const plan = await buildSearchAdPackagePlan(body.package);
    return NextResponse.json({ ok: true, saved: 0, plan });
  }

  return NextResponse.json(
    { ok: false, error: 'package_id 또는 package 본문이 필요합니다.' },
    { status: 400 },
  );
};

export const POST = withAdminGuard(handler);
