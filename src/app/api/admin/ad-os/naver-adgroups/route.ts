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
      error: 'Naver Ads API is not configured.',
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
      error: 'Naver ad group lookup failed.',
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
          error: verified.error ? 'Naver ad group verification failed.' : undefined,
        }
      : null,
    recommended_env: result.adgroups[0]?.nccAdgroupId
      ? { NAVER_ADS_ADGROUP_ID: result.adgroups[0].nccAdgroupId }
      : null,
  });
});
