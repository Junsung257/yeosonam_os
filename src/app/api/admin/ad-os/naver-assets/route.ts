import { NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
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
    return NextResponse.json({
      ok: false,
      error: '네이버 검색광고 API 키가 부족합니다.',
      config,
      assets: { campaigns: [], adgroups: [], channels: [] },
      next_action: 'NAVER_ADS_API_KEY, NAVER_ADS_SECRET_KEY, NAVER_ADS_CUSTOMER_ID를 먼저 설정하세요.',
    }, { status: 400 });
  }

  const [campaignRes, adgroupRes, channelRes] = await Promise.all([
    fetchNaverCampaigns({ recordSize: 100 }),
    fetchNaverAdgroups({ recordSize: 100 }),
    fetchNaverBusinessChannels({ recordSize: 100 }),
  ]);

  const firstError = campaignRes.error || adgroupRes.error || channelRes.error;
  if (firstError) {
    return NextResponse.json({
      ok: false,
      error: firstError,
      config,
      assets: {
        campaigns: campaignRes.campaigns,
        adgroups: adgroupRes.adgroups,
        channels: channelRes.channels,
      },
    }, { status: 502 });
  }

  const nextAction = adgroupRes.adgroups[0]?.nccAdgroupId
    ? `외부 그룹 ID에 ${adgroupRes.adgroups[0].nccAdgroupId}를 저장하면 정지 키워드 업로드를 점검할 수 있습니다.`
    : campaignRes.campaigns.length === 0
      ? '네이버 광고센터에서 검색광고 캠페인을 먼저 만들어야 합니다.'
      : channelRes.channels.length === 0
        ? '네이버 광고센터에서 웹사이트 비즈채널을 먼저 등록/검수해야 합니다.'
        : '캠페인과 비즈채널은 있으나 광고그룹이 없습니다. 네이버 광고센터에서 광고그룹을 만들거나 API 생성 단계를 추가해야 합니다.';

  return NextResponse.json({
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
