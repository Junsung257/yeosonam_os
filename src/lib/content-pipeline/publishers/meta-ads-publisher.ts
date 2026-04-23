/**
 * Meta Ads Publisher
 *
 * content_distributions(platform='meta_ads', status='scheduled') 를
 * Meta Business Graph API 로 실제 캠페인 생성 + 광고 발행.
 *
 * 흐름:
 *   1. Campaign 생성 (objective: REACH / CONVERSIONS / TRAFFIC 등)
 *   2. AdSet 생성 (audience, budget, schedule)
 *   3. AdCreative 생성 (payload.primary_texts / headlines / descriptions / cta)
 *   4. Ad 생성 (AdSet + Creative 연결)
 *   5. status='published' + external_id (campaign_id 또는 ad_id)
 *
 * 필수 env:
 *   META_AD_ACCOUNT_ID     = 'act_XXXXXXXXXX' (Meta Business Manager)
 *   META_ADS_ACCESS_TOKEN  = 장기 토큰 (ads_management 권한)
 *   META_PAGE_ID           = 광고 소유 Facebook 페이지 ID
 *   META_INSTAGRAM_ACCOUNT_ID = IG 비즈니스 계정 ID (옵션, IG 노출용)
 *
 * 비용 안전장치:
 *   - default daily_budget_krw = 10,000 (사용자가 명시적으로 override)
 *   - test mode: META_ADS_TEST_MODE=1 이면 draft 상태로만 생성 (발행 안 함)
 *
 * 주의: 실제 광고 발행은 돈을 씀. 사장님이 env 설정 전까지 항상 stub 모드 동작.
 */

export interface MetaAdsPublishInput {
  primary_texts: string[];
  headlines: string[];
  descriptions: string[];
  cta_button: string;
  landing_url: string;
  daily_budget_krw?: number;       // 기본 10,000
  start_time?: string;              // ISO 8601, 기본 지금
  end_time?: string;                // ISO 8601, 기본 7일 후
  audience_hint?: string;           // 향후 targeting spec 생성용
}

export interface MetaAdsPublishResult {
  campaign_id?: string;
  adset_id?: string;
  ad_ids?: string[];
  external_url?: string;
  status: 'published' | 'draft' | 'error';
  error?: string;
  test_mode: boolean;
}

export async function publishToMetaAds(input: MetaAdsPublishInput): Promise<MetaAdsPublishResult> {
  const accountId = process.env.META_AD_ACCOUNT_ID;
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  const testMode = process.env.META_ADS_TEST_MODE === '1';

  if (!accountId || !token || !pageId) {
    return {
      status: 'error',
      error: 'Meta Ads env 미설정 (META_AD_ACCOUNT_ID / META_ADS_ACCESS_TOKEN / META_PAGE_ID)',
      test_mode: testMode,
    };
  }

  const budgetKrw = input.daily_budget_krw ?? 10000;
  const budgetCents = Math.round(budgetKrw * 100);  // Meta API 는 통화 최소 단위
  const startTime = input.start_time ?? new Date().toISOString();
  const endTime = input.end_time ?? new Date(Date.now() + 7 * 86400000).toISOString();

  const api = `https://graph.facebook.com/v20.0`;

  try {
    // 1. Campaign 생성
    const campaignRes = await fetch(`${api}/${accountId}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Yeosonam ${new Date().toISOString().slice(0, 10)}`,
        objective: 'OUTCOME_TRAFFIC',
        status: testMode ? 'PAUSED' : 'ACTIVE',
        special_ad_categories: [],
        access_token: token,
      }),
    });
    const campaignData = await campaignRes.json();
    if (!campaignRes.ok || !campaignData.id) {
      return {
        status: 'error',
        error: `Campaign 생성 실패: ${JSON.stringify(campaignData.error ?? campaignData)}`,
        test_mode: testMode,
      };
    }
    const campaignId = campaignData.id as string;

    // 2. AdSet 생성
    const adsetRes = await fetch(`${api}/${accountId}/adsets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Yeosonam AdSet ${Date.now()}`,
        campaign_id: campaignId,
        daily_budget: budgetCents,
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LINK_CLICKS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        start_time: startTime,
        end_time: endTime,
        targeting: {
          geo_locations: { countries: ['KR'] },
          age_min: 25,
          age_max: 55,
        },
        status: testMode ? 'PAUSED' : 'ACTIVE',
        access_token: token,
      }),
    });
    const adsetData = await adsetRes.json();
    if (!adsetRes.ok || !adsetData.id) {
      return {
        status: 'error',
        error: `AdSet 생성 실패: ${JSON.stringify(adsetData.error ?? adsetData)}`,
        test_mode: testMode,
        campaign_id: campaignId,
      };
    }
    const adsetId = adsetData.id as string;

    // 3. AdCreative + Ad (첫 번째 헤드라인·primary_text·description 조합만 생성 — 후속 반복으로 확장)
    const creativeRes = await fetch(`${api}/${accountId}/adcreatives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Yeosonam Creative ${Date.now()}`,
        object_story_spec: {
          page_id: pageId,
          link_data: {
            link: input.landing_url,
            message: input.primary_texts[0] ?? '',
            name: input.headlines[0] ?? '',
            description: input.descriptions[0] ?? '',
            call_to_action: { type: input.cta_button },
          },
        },
        access_token: token,
      }),
    });
    const creativeData = await creativeRes.json();
    if (!creativeRes.ok || !creativeData.id) {
      return {
        status: 'error',
        error: `Creative 생성 실패: ${JSON.stringify(creativeData.error ?? creativeData)}`,
        test_mode: testMode,
        campaign_id: campaignId,
        adset_id: adsetId,
      };
    }

    const adRes = await fetch(`${api}/${accountId}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Yeosonam Ad ${Date.now()}`,
        adset_id: adsetId,
        creative: { creative_id: creativeData.id },
        status: testMode ? 'PAUSED' : 'ACTIVE',
        access_token: token,
      }),
    });
    const adData = await adRes.json();
    if (!adRes.ok || !adData.id) {
      return {
        status: 'error',
        error: `Ad 생성 실패: ${JSON.stringify(adData.error ?? adData)}`,
        test_mode: testMode,
        campaign_id: campaignId,
        adset_id: adsetId,
      };
    }

    return {
      status: testMode ? 'draft' : 'published',
      campaign_id: campaignId,
      adset_id: adsetId,
      ad_ids: [adData.id as string],
      external_url: `https://www.facebook.com/adsmanager/manage/campaigns?act=${accountId.replace('act_', '')}&selected_campaign_ids=${campaignId}`,
      test_mode: testMode,
    };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      test_mode: testMode,
    };
  }
}
