import { NextRequest } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { fetchNaverAdgroupById, fetchNaverAdgroups, getNaverAdsConfigStatus } from '@/lib/search-ads-api';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const nccCampaignId = typeof body.nccCampaignId === 'string' ? body.nccCampaignId.trim() : undefined;
  const nccAdgroupId = typeof body.nccAdgroupId === 'string' ? body.nccAdgroupId.trim() : '';
  const config = getNaverAdsConfigStatus();

  if (!config.configured) {
    return apiResponse({
      ok: false,
      error: '네이버 광고 계정 연결이 필요합니다.',
      config,
      adgroups: [],
    }, { status: 400 });
  }

  const [result, verified] = await Promise.all([
    fetchNaverAdgroups({ nccCampaignId, recordSize: 100 }),
    nccAdgroupId ? fetchNaverAdgroupById(nccAdgroupId) : Promise.resolve(null),
  ]);
  if (!result.ok) {
    return apiResponse({
      ok: false,
      error: '네이버 광고그룹 조회에 실패했습니다.',
      config,
      adgroups: [],
    }, { status: 502 });
  }

  return apiResponse({
    ok: true,
    config,
    count: result.adgroups.length,
    adgroups: result.adgroups.slice(0, 50),
    verified_adgroup: verified
      ? {
          ok: verified.ok,
          adgroup: verified.adgroup,
          error: verified.error ? '네이버 광고그룹 확인에 실패했습니다.' : undefined,
        }
      : null,
    recommended_env: result.adgroups[0]?.nccAdgroupId
      ? { NAVER_ADS_ADGROUP_ID: result.adgroups[0].nccAdgroupId }
      : null,
  });
});
