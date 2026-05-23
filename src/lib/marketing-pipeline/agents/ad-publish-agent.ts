/**
 * AdPublishAgent — 승인된 DRAFT 광고 캠페인을 실제 플랫폼에 게재
 *
 * Two-phase 게이트:
 *   1. ad-agent.ts가 DRAFT 생성
 *   2. 어드민이 수동 검토 → status='approved'로 변경
 *   3. AdPublishAgent가 approved → active로 전환 후 실제 API 게재
 *
 * 안전 장치:
 *   - 예산 상한 (기본 50,000 KRW / 일)
 *   - dryRun 모드 (DB 변경 없음)
 *   - agent_incidents 테이블에 실패 기록
 */
import { BaseMarketingAgent, type MarketingContext, type AgentResult } from '../base-agent';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { resolveOAuthToken } from '../token-resolver';

/** 기본 일 최대 예산 (KRW) — budget_override=true면 무시 */
const DEFAULT_MAX_DAILY_BUDGET = 50000;

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
          // Dry-run: 로그만 출력, DB 변경 없음
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

        // 3d. 플랫폼별 API 호출 (현재 stub — 실제 연동 시 구현)
        const adAccountId = campaign.ad_account_id;
        const creativePayload = (creatives ?? []) as AdCreativeRow[];

        if (platform === 'meta') {
          await this.publishToMeta(campaign, creativePayload, ctx.runDate);
        } else if (platform === 'google') {
          await this.publishToGoogle(campaign, creativePayload, ctx.runDate);
        }

        // 3e. DB 상태 업데이트: approved → active
        const { error: updateErr } = await supabaseAdmin
          .from('ad_campaigns')
          .update({
            status: 'active',
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaign.id);

        if (updateErr) throw updateErr;

        result.published++;
        result.estimated_daily_spend += budget;
        result.published_campaigns.push({
          campaign_id: campaign.id,
          platform,
          campaign_name: campaign.name,
          daily_budget: budget,
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

  // ── Meta Marketing API (stub) ────────────────────────────────────────────

  private async publishToMeta(
    campaign: AdCampaignRow,
    creatives: AdCreativeRow[],
    runDate: string,
  ): Promise<void> {
    const adAccountId = campaign.ad_account_id ?? 'act_XXXXXXXXX';

    // 실제 payload 구조 (참고용)
    const payload = {
      ad_account_id: adAccountId,
      campaign_id: campaign.id,
      status: 'ACTIVE',
      name: campaign.name,
      creative: creatives[0]
        ? {
            creative_id: creatives[0].id,
            object_story_spec: {
              page_id: '<PAGE_ID>',
              link_data: {
                message: (creatives[0].ad_copies as { primary_texts?: string[] })?.primary_texts?.[0] ?? campaign.name,
                link: '<LANDING_PAGE_URL>',
                call_to_action: { type: (creatives[0].ad_copies as { cta_button?: string })?.cta_button ?? 'BOOK_TRAVEL' },
              },
            },
          }
        : undefined,
    };

    // TODO: 실제 Meta Graph API 호출
    // POST /v18.0/{ad_account_id}/ads
    console.log(`[ad-publish] [META] 게재 요청 (stub):`, JSON.stringify(payload, null, 2));
    console.log(`[ad-publish] [META] runDate=${runDate}, 토큰 만료=${(await resolveOAuthToken('', 'meta'))?.expiresAt ?? 'unknown'}`);
  }

  // ── Google Ads API (stub) ────────────────────────────────────────────────

  private async publishToGoogle(
    campaign: AdCampaignRow,
    creatives: AdCreativeRow[],
    runDate: string,
  ): Promise<void> {
    const customerId = campaign.ad_account_id ?? '123-456-7890';

    // 실제 payload 구조 (참고용)
    const payload = {
      customer_id: customerId,
      campaign_id: campaign.id,
      status: 'ENABLED',
      name: campaign.name,
      ad_group: {
        name: `${campaign.name} - AdGroup`,
        type: 'SEARCH_STANDARD',
      },
      ad: creatives[0]
        ? {
            type: 'RESPONSIVE_SEARCH_AD',
            headlines: (creatives[0].ad_copies as { headlines?: string[] })?.headlines?.map(h => ({ text: h })) ?? [],
            descriptions: (creatives[0].ad_copies as { primary_texts?: string[] })?.primary_texts?.map(t => ({ text: t })) ?? [],
          }
        : undefined,
    };

    // TODO: 실제 Google Ads API 호출
    // POST /v16/customers/{customer_id}/googleAds:mutate
    console.log(`[ad-publish] [GOOGLE] 게재 요청 (stub):`, JSON.stringify(payload, null, 2));
    console.log(`[ad-publish] [GOOGLE] runDate=${runDate}`);
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
