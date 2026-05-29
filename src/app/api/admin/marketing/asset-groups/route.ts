import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getMarketingAssetGroups } from '@/lib/marketing/asset-groups';

export const dynamic = 'force-dynamic';

async function getHandler(request: NextRequest) {
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') ?? 30), 1), 100);
  const data = await getMarketingAssetGroups(limit);
  return NextResponse.json({
    checked_at: new Date().toISOString(),
    ...data,
  });
}

export const GET = withAdminGuard(getHandler);
