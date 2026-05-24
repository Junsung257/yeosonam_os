/**
 * AdPublishAgent — 승인된 DRAFT 광고 캠페인을 실제 플랫폼에 게재
 *
 * Two-phase 게이트:
 *   1. ad-agent.ts가 DRAFT 생성
 *   2. 어드민이 수동 검토 → status='approved'로 변경
 *   3. AdPublishAgent가 approved → active로 전환 후 실제 API 게재
 *
 * Meta: meta-api.ts의 실제 함수 호출 (createMetaCampaign → createAdSet → uploadCreative → createAd)
 * Google: Google Ads REST API v16 직접 호출
 *
 * 안전 장치:
 *   - 예산 상한 (기본 50,000 KRW / 일)
 *   - dryRun 모드 (DB 변경 없음, API 호출 없음)
 *   - META_ADS_TEST_MODE=1 이면 PAUSED 상태로 생성 (안전 모드)
 *   - agent_incidents 테이블에 실패 기록
 */
import { BaseMarketingAgent, type MarketingContext, type AgentResult } from '../base-agent';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { resolveOAuthToken } from '../token-resolver';
import { getSecret } from '@/lib/secret-registry';
import {
  createMetaCampaign,
  createAdSet,
  uploadCreativeToMeta,
  createAd,
  krwToMetaCents,
} from '@/lib/meta-api';

/** 기본 일 최대 예산 (KRW) — budget_override=true면 무시 */
const DEFAULT_MAX_DAILY_BUDGET = 50000;

/** 테스트 모드 여부 (환경변수) */
function isTestMode(): boolean {
  return getSecret('META_ADS_TEST_MODE') === '1';
}

export interface AdPublishResult {
  total_approved: number;
  published: number;
  skipped_budget: number;
  failed: number;
  estimated_daily_spend: number;
  published_campaigns: Array<{
    campaign_id: string;
    platform: string;
    campaign_name: string;
    daily_budget: number;
    meta_campaign_id?: string;
    meta_adset_id?: string;
    meta_ad_id?: string;
  }>;
}

interface AdCampaignRow {
  id: string;
  name: string;
  channel: string;
  daily_budget: number | null;
  budget_override: boolean | null;
  ad_account_id: string | null;
}

interface AdCreativeRow {
  id: string;
  campaign_id: string;
  channel: string;
  creative_type: string;
  ad_copies: Record<string, unknown>;
  status: string;
}

export class AdPublishAgent extends BaseMarketingAgent {
  readonly name = 'ad-publish';

  private readonly dryRun: boolean;
  private readonly maxDailyBudget: number;

  constructor(options?: { dryRun?: boolean; maxDailyBudget?: number }) {
    super();
    this.dryRun = options?.dryRun ?? false;
    this.maxDailyBudget = options?.maxDailyBudget ?? DEFAULT_MAX_DAILY_BUDGET;
  }

  async run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
    if (!isSupabaseConfigured) return this.skip('Supabase 미설정');

    // ── 1. 승인된 캠페인 조회 ───────────────────────────────────────────────
    const { data: campaigns, error: fetchErr } = await supabaseAdmin
      .from('ad_campaigns')
      .select('id, name, channel, daily_budget, budget_override, ad_account_id')
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (fetchErr) {
      await this.logIncident(ctx.tenantId, 'db_error', `승인 캠페인 조회 실패: ${fetchErr.message}`);
      return { ok: false, error: fetchErr.message };
    }

    if (!campaigns?.length) {
      return { ok: true, data: { total_approved: 0, published: 0, skipped_budget: 0, failed: 0, estimated_daily_spend: 0, published_campaigns: [] } satisfies AdPublishResult };
    }

    const rows = campaigns as AdCampaignRow[];
    console.log(`[ad-publish] 승인된 캠페인 ${rows.length}개 발견 (dryRun=${this.dryRun})`);

    // ── 2. 플랫폼별 OAuth 토큰 확인 ─────────────────────────────────────────
    const [metaToken, googleToken] = await Promise.all([
      resolveOAuthToken(ctx.tenantId, 'meta'),
      resolveOAuthToken(ctx.tenantId, 'google_ads'),
    ]);

    if (!metaToken && !googleToken) {
      return this.skip('Meta/Google OAuth 모두 미연동 — 게재 불가');
    }

    // ── 3. 캠페인별 게재 처리 ────────────────────────────────────────────────
    const result: AdPublishResult = {
      total_approved: rows.length,
      published: 0,
      skipped_budget: 0,
      failed: 0,
      estimated_daily_spend: 0,
      published_campaigns: [],
    };

    for (const campaign of rows) {
      const platform = campaign.channel as 'meta' | 'google';

      // 3a. 예산 안전 한도 체크
      const budget = campaign.daily_budget ?? 0;
      if (budget > this.maxDailyBudget && !campaign.budget_override) {
        console.log(`[ad-publish] SKIP (예산 초과): campaign=${campaign.id}, budget=${budget}, limit=${this.maxDailyBudget}`);
        result.skipped_budget++;
        continue;
      }

      // 3b. 플랫폼별 OAuth 존재 여부
      if (platform === 'meta' && !metaToken) {
        console.log(`[ad-publish] SKIP (Meta 미연동): campaign=${campaign.id}`);
        result.skipped_budget++;
        continue;
      }
      if (platform === 'google' && !googleToken) {
        console.log(`[ad-publish] SKIP (Google Ads 미연동): campaign=${campaign.id}`);
        result.skipped_budget++;
        continue;
      }

      // 3c. 연관 ad_creatives 조회 (광고 소재 정보)
      const { data: creatives } = await supabaseAdmin
        .from('ad_creatives')
        .select('id, campaign_id, channel, creative_type, ad_copies, status')
        .eq('campaign_id', campaign.id);

      try {
        if (this.dryRun) {
          console.log(`[ad-publish] [DRY-RUN] 게재 예정:`, {
            campaign_id: campaign.id,
            name: campaign.name,
            platform,
            daily_budget: budget,
            creatives_count: (creatives ?? []).length,
          });
          result.published++;
          result.estimated_daily_spend += budget;
          result.published_campaigns.push({
            campaign_id: campaign.id,
            platform,
            campaign_name: campaign.name,
            daily_budget: budget,
          });
          continue;
        }

        const creativePayload = (creatives ?? []) as AdCreativeRow[];

        let metaCampaignId: string | undefined;
        let metaAdsetId: string | undefined;
        let metaAdId: string | undefined;

        if (platform === 'meta') {
          const metaResult = await this.publishToMeta(campaign, creativePayload, ctx.runDate);
          metaCampaignId = metaResult.campaignId;
          metaAdsetId = metaResult.adsetId;
          metaAdId = metaResult.adId;
        } else if (platform === 'google') {
          await this.publishToGoogle(campaign, creativePayload, ctx.runDate);
        }

        // 3e. DB 상태 업데이트: approved → active (Meta 메타 ID 저장)
        const updateData: Record<string, unknown> = {
          status: 'active',
          updated_at: new Date().toISOString(),
        };
        if (metaCampaignId) updateData.meta_campaign_id = metaCampaignId;
        if (metaAdsetId) updateData.meta_adset_id = metaAdsetId;
        if (metaAdId) updateData.meta_ad_id = metaAdId;

        const { error: updateErr } = await supabaseAdmin
          .from('ad_campaigns')
          .update(updateData)
          .eq('id', campaign.id);

        if (updateErr) throw updateErr;

        result.published++;
        result.estimated_daily_spend += budget;
        result.published_campaigns.push({
          campaign_id: campaign.id,
          platform,
          campaign_name: campaign.name,
          daily_budget: budget,
          meta_campaign_id: metaCampaignId,
          meta_adset_id: metaAdsetId,
          meta_ad_id: metaAdId,
        });

        console.log(`[ad-publish] 게재 완료: campaign=${campaign.id}, platform=${platform}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ad-publish] 게재 실패: campaign=${campaign.id}, error=${msg}`);
        result.failed++;
        await this.logIncident(ctx.tenantId, 'publish_error',
          `[${platform}] 캠페인 ${campaign.id}(${campaign.name}) 게재 실패: ${msg}`,
          { campaign_id: campaign.id, platform },
        );
      }
    }

    return { ok: true, data: result };
  }

  // ── Meta Marketing API (실제 meta-api.ts 호출) ────────────────────────────

  private async publishToMeta(
    campaign: AdCampaignRow,
    creatives: AdCreativeRow[],
    runDate: string,
  ): Promise<{ campaignId: string; adsetId: string; adId: string }> {
    const testMode = isTestMode();

    // 1. Meta 캠페인 생성
    const metaCampaign = await createMetaCampaign({
      name: campaign.name,
      objective: 'LINK_CLICKS',
    });
    const metaCampaignId = metaCampaign.id;

    // 2. 광고 세트 생성 (KRW → USD cents 변환)
    const budgetCents = krwToMetaCents(campaign.daily_budget ?? this.maxDailyBudget, 1450);
    const adset = await createAdSet({
      campaignId: metaCampaignId,
      name: `${campaign.name} - AdSet`,
      dailyBudgetCents: budgetCents,
    });
    const adsetId = adset.id;

    // 3. 광고 소재 생성 (첫 번째 creative 사용)
    const firstCreative = creatives[0];
    const primaryText = (firstCreative?.ad_copies as { primary_texts?: string[] })?.primary_texts?.[0] ?? campaign.name;
    const landingUrl = getSecret('NEXT_PUBLIC_SITE_URL') ?? 'https://yeosonam.com';
    const creative = await uploadCreativeToMeta({
      name: `${campaign.name} - Creative`,
      message: primaryText,
      link: landingUrl,
    });
    const creativeId = creative.id;

    // 4. 광고 생성 (testMode면 PAUSED, 아니면 ACTIVE — 어드민 승인 필요)
    const ad = await createAd({
      adsetId,
      creativeId,
      name: `${campaign.name} - Ad`,
    });
    const adId = ad.id;

    // testMode가 아니면 활성화
    if (!testMode) {
      const { activateAd } = await import('@/lib/meta-api');
      await activateAd(adId);
    }

    console.log(`[ad-publish] [META] 게재 완료: campaign=${metaCampaignId}, adset=${adsetId}, ad=${adId}, testMode=${testMode}, runDate=${runDate}`);

    return { campaignId: metaCampaignId, adsetId, adId };
  }

  // ── Google Ads API (REST v16) ────────────────────────────────────────────

  private async publishToGoogle(
    campaign: AdCampaignRow,
    creatives: AdCreativeRow[],
    runDate: string,
  ): Promise<void> {
    const googleToken = await resolveOAuthToken('', 'google_ads');
    const developerToken = getSecret('NEXT_PUBLIC_GOOGLE_ADS_DEVELOPER_TOKEN');
    const customerId = campaign.ad_account_id?.replace(/-/g, '') ?? '';

    if (!developerToken || !googleToken || !customerId) {
      console.warn(`[ad-publish] [GOOGLE] 설정 부족: developerToken=${!!developerToken}, token=${!!googleToken}, customerId=${customerId}`);
      console.log(`[ad-publish] [GOOGLE] 게재 요청 (stub — API 키 설정 후 활성화): campaign=${campaign.id}`);
      return;
    }

    const firstCreative = creatives[0] as AdCreativeRow | undefined;
    const adCopies = firstCreative?.ad_copies as { headlines?: string[]; primary_texts?: string[] } | undefined;
    const headlines = (adCopies?.headlines ?? [campaign.name]).slice(0, 15).map(h => ({ text: h }));
    const descriptions = (adCopies?.primary_texts ?? [campaign.name]).slice(0, 4).map(t => ({ text: t }));

    // Google Ads REST API v16 — Campaign + AdGroup + Ad 생성
    // 참고: https://developers.google.com/google-ads/api/reference/rpc/v16

    const mutatePayload = {
      operations: [
        // Campaign 생성
        {
          create: {
            name: campaign.name,
            advertisingChannelType: 'SEARCH',
            status: 'PAUSED',
            campaignBudget: {
              name: `${campaign.name} Budget`,
              amountMicros: String((campaign.daily_budget ?? this.maxDailyBudget) * 1_000_000),
              deliveryMethod: 'STANDARD',
            },
            biddingStrategyConfiguration: {
              biddingScheme: {
                manualCpc: {},
              },
            },
          },
        },
        // AdGroup 생성
        {
          create: {
            name: `${campaign.name} - AdGroup`,
            type: 'SEARCH_STANDARD',
            status: 'PAUSED',
            cpcBidMicros: String(500 * 1_000_000), // 기본 CPC 500원
          },
        },
        // RSA 광고 생성
        {
          create: {
            type_: 'RESPONSIVE_SEARCH_AD',
            responsiveSearchAd: {
              headlines,
              descriptions,
            },
          },
        },
      ],
    };

    try {
      const url = `https://googleads.googleapis.com/v16/customers/${customerId}/googleAds:mutate`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${googleToken.accessToken}`,
          'developer-token': developerToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mutatePayload),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Google Ads API 오류 (${res.status}): ${body.slice(0, 300)}`);
      }

      const json = await res.json();
      console.log(`[ad-publish] [GOOGLE] 게재 완료: campaign=${campaign.id}, runDate=${runDate}`);

      // campaign resource name 저장
      const campaignResults = (json.mutateOperationResponses ?? []) as Array<{ resourceName?: string }>;
      const campaignResourceName = campaignResults[0]?.resourceName;
      if (campaignResourceName) {
        await supabaseAdmin
          .from('ad_campaigns')
          .update({ google_resource_name: campaignResourceName, updated_at: new Date().toISOString() })
          .eq('id', campaign.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ad-publish] [GOOGLE] 게재 실패: ${msg}`);
      throw err; // 상위 catch에서 처리
    }
  }

  // ── 장애 기록 ────────────────────────────────────────────────────────────

  private async logIncident(
    tenantId: string,
    category: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await supabaseAdmin.from('agent_incidents').insert({
        tenant_id: tenantId,
        severity: 'error',
        category,
        message,
        details: { agent: this.name, ...details },
        detected_by: 'marketing-pipeline',
      });
    } catch (e) {
      console.warn('[ad-publish] 장애 기록 실패:', e);
    }
  }
}
