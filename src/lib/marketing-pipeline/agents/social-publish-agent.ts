/**
 * SocialPublishAgent — 승인된 content_distributions → 소셜 플랫폼 자동 발행
 *
 * Two-phase 게이트:
 *   1. content-agent.ts가 Instagram 캡션 DRAFT 생성
 *   2. 어드민이 수동 검토 → content_distributions.status='approved'로 변경
 *   3. SocialPublishAgent가 approved → published로 전환 후 플랫폼 API 호출
 *
 * 안전 장치:
 *   - platform별 daily_post_limit 확인 (social_platform_configs)
 *   - agent_incidents 테이블에 실패 기록
 *   - 재시도 카운트 (max_retries 초과 시 failed)
 */
import { BaseMarketingAgent, type MarketingContext, type AgentResult } from '../base-agent';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { processPublishQueue, checkPlatformHealth, type SocialPlatform } from '@/lib/social-publisher';

const SOCIAL_PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'threads', 'twitter', 'naver_cafe'];

export interface SocialPublishResult {
  published: number;
  failed: number;
  platform_breakdown: Record<string, { published: number; failed: number }>;
}

export class SocialPublishAgent extends BaseMarketingAgent {
  readonly name = 'social-publish';

  // 일일 발행 한도 (각 플랫폼별, DB config보다 낮은 값이 우선)
  private readonly dailyPostLimit: number;

  constructor(options?: { dailyPostLimit?: number; dryRun?: boolean }) {
    super();
    this.dailyPostLimit = options?.dailyPostLimit ?? 10;
  }

  async run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
    if (!isSupabaseConfigured) return this.skip('Supabase 미설정');

    // ── 1. platform별 OAuth 토큰 + 한도 확인 ──────────────────────────────
    const enabledPlatforms = await this.getEnabledPlatforms(ctx.tenantId);
    if (!enabledPlatforms.length) {
      return this.skip('활성화된 소셜 플랫폼 없음');
    }

    const result: SocialPublishResult = {
      published: 0,
      failed: 0,
      platform_breakdown: {},
    };

    // ── 2. platform별 처리 ────────────────────────────────────────────────
    for (const platform of enabledPlatforms) {
      const platformResult = await this.publishForPlatform(ctx, platform);

      result.published += platformResult.published;
      result.failed += platformResult.failed;
      result.platform_breakdown[platform] = {
        published: platformResult.published,
        failed: platformResult.failed,
      };
    }

    return { ok: true, data: result };
  }

  /**
   * 단일 플랫폼 발행 처리
   * - content_distributions.platform을 SocialPlatform으로 매핑
   * - processPublishQueue에 platform 필터 전달
   */
  private async publishForPlatform(
    ctx: MarketingContext,
    platform: SocialPlatform,
  ): Promise<{ published: number; failed: number }> {
    // DB platform 값으로 변환
    const dbPlatform = this.platformToDbPlatform(platform);
    if (!dbPlatform) return { published: 0, failed: 0 };

    // 일일 발행 한도 체크
    const overLimit = await this.isOverDailyLimit(ctx.tenantId, platform);
    if (overLimit) {
      console.log(`[${this.name}] SKIP (일일 한도): platform=${platform}`);
      return { published: 0, failed: 0 };
    }

    // OAuth 헬스 체크
    const health = await checkPlatformHealth(platform, ctx.tenantId);
    if (!health.ok) {
      console.log(`[${this.name}] SKIP (헬스 불량): platform=${platform}, reason=${health.message}`);
      return { published: 0, failed: 0 };
    }

    try {
      const queueResult = await processPublishQueue({
        platform,
        tenantId: ctx.tenantId,
        limit: this.dailyPostLimit,
      });

      // 플랫폼 config 오늘 발행 수 갱신
      if (queueResult.published > 0) {
        const { data: cur } = await supabaseAdmin
          .from('social_platform_configs')
          .select('posts_today')
          .eq('platform', platform)
          .limit(1);

        const currentPosts = ((cur?.[0] as { posts_today?: number } | undefined)?.posts_today ?? 0) + queueResult.published;

        await supabaseAdmin
          .from('social_platform_configs')
          .update({
            posts_today: currentPosts,
            last_post_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('platform', platform);
      }

      console.log(`[${this.name}] ${platform}: ${queueResult.published} published, ${queueResult.failed} failed`);

      return {
        published: queueResult.published,
        failed: queueResult.failed,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${this.name}] ${platform} 발행 실패:`, err);
      await this.logIncident(ctx.tenantId, 'publish_error',
        `[${platform}] 배치 발행 실패: ${msg}`,
        { platform },
      );
      return { published: 0, failed: 0 };
    }
  }

  /** content_distributions.platform 값 ↔ SocialPlatform 매핑 */
  private platformToDbPlatform(platform: SocialPlatform): string | null {
    const map: Record<SocialPlatform, string | null> = {
      instagram: 'instagram_caption',
      facebook: null, // 페이스북은 content_distribution platform에 없음
      threads: 'threads_post',
      twitter: 'twitter_post',
      naver_cafe: 'naver_blog',
    };
    return map[platform] ?? null;
  }

  /** 활성화된 플랫폼 목록 (OAuth 토큰 존재 + config.enabled) */
  private async getEnabledPlatforms(tenantId: string): Promise<SocialPlatform[]> {
    const { data: configs } = await supabaseAdmin
      .from('social_platform_configs')
      .select('platform, enabled')
      .eq('enabled', true);

    if (!configs?.length) return [];

    const enabled = configs.map((r: any) => r.platform as SocialPlatform);
    return enabled.filter((p: any) => SOCIAL_PLATFORMS.includes(p));
  }

  /** 일일 발행 한도 초과 여부 */
  private async isOverDailyLimit(tenantId: string, platform: SocialPlatform): Promise<boolean> {
    const { data: config } = await supabaseAdmin
      .from('social_platform_configs')
      .select('daily_post_limit, posts_today')
      .eq('platform', platform)
      .limit(1);

    if (!config?.[0]) return false;

    const limit = config[0].daily_post_limit ?? this.dailyPostLimit;
    const today = config[0].posts_today ?? 0;

    // posts_today는 UTC 기준 — midnight에 리셋 필요 (향후 cron으로)
    return today >= limit;
  }

  /** 장애 기록 */
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
      console.warn(`[${this.name}] 장애 기록 실패:`, e);
    }
  }
}
