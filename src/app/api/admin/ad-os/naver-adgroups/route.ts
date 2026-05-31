import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { fetchNaverAdgroupById, fetchNaverAdgroups, getNaverAdsConfigStatus } from '@/lib/search-ads-api';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const nccCampaignId = typeof body.nccCampaignId === 'string' ? body.nccCampaignId.trim() : undefined;
  const nccAdgroupId = typeof body.nccAdgroupId === 'string' ? body.nccAdgroupId.trim() : '';
  const config = getNaverAdsConfigStatus();

  if (!config.configured) {
    return NextResponse.json({
      ok: false,
      error: '네이버 검색광고 API 키가 부족합니다.',
      config,
      adgroups: [],
    }, { status: 400 });
  }

  const [result, verified] = await Promise.all([
    fetchNaverAdgroups({ nccCampaignId, recordSize: 100 }),
    nccAdgroupId ? fetchNaverAdgroupById(nccAdgroupId) : Promise.resolve(null),
  ]);
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: result.error || '네이버 광고그룹 조회 실패',
      config,
      adgroups: [],
    }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    config,
    count: result.adgroups.length,
    adgroups: result.adgroups.slice(0, 50),
    verified_adgroup: verified
      ? {
          ok: verified.ok,
          adgroup: verified.adgroup,
          error: verified.error,
        }
      : null,
    recommended_env: result.adgroups[0]?.nccAdgroupId
      ? { NAVER_ADS_ADGROUP_ID: result.adgroups[0].nccAdgroupId }
      : null,
  });
});
