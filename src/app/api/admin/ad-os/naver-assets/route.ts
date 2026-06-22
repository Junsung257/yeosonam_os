import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import {
  fetchNaverAdgroups,
  fetchNaverBusinessChannels,
  fetchNaverCampaigns,
  getNaverAdsConfigStatus,
} from '@/lib/search-ads-api';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async () => {
  const config = getNaverAdsConfigStatus();

  if (!config.configured) {
    return apiResponse({
      ok: false,
      error: '네이버 광고 계정 연결이 필요합니다.',
      config,
      assets: { campaigns: [], adgroups: [], channels: [] },
      next_action: '네이버 광고 계정 연결을 먼저 완료하세요.',
    }, { status: 400 });
  }

  const [campaignRes, adgroupRes, channelRes] = await Promise.all([
    fetchNaverCampaigns({ recordSize: 100 }),
    fetchNaverAdgroups({ recordSize: 100 }),
    fetchNaverBusinessChannels({ recordSize: 100 }),
  ]);

  const firstError = campaignRes.error || adgroupRes.error || channelRes.error;
  if (firstError) {
    return apiResponse({
      ok: false,
      error: '네이버 광고 자산 조회에 실패했습니다.',
      config,
      assets: {
        campaigns: campaignRes.campaigns,
        adgroups: adgroupRes.adgroups,
        channels: channelRes.channels,
      },
    }, { status: 502 });
  }

  const nextAction = adgroupRes.adgroups[0]?.nccAdgroupId
    ? `Store ad group ID ${adgroupRes.adgroups[0].nccAdgroupId} to enable policy-driven uploads.`
    : campaignRes.campaigns.length === 0
      ? 'Create a Naver SearchAd campaign in Naver Ads Manager first.'
      : channelRes.channels.length === 0
        ? 'Register or verify a business channel in Naver Ads Manager first.'
        : 'Campaigns and business channels exist, but no ad groups were found. Create an ad group in Naver Ads Manager or add the API creation step.';

  return apiResponse({
    ok: true,
    config,
    counts: {
      campaigns: campaignRes.campaigns.length,
      adgroups: adgroupRes.adgroups.length,
      channels: channelRes.channels.length,
    },
    assets: {
      campaigns: campaignRes.campaigns.slice(0, 20),
      adgroups: adgroupRes.adgroups.slice(0, 20),
      channels: channelRes.channels.slice(0, 20),
    },
    recommended: {
      external_ad_group_id: adgroupRes.adgroups[0]?.nccAdgroupId || null,
      external_campaign_id: campaignRes.campaigns[0]?.nccCampaignId || null,
      external_account_id: channelRes.channels[0]?.nccBusinessChannelId || null,
    },
    next_action: nextAction,
  });
});
