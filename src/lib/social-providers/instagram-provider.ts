/**
 * IGProvider — 기존 instagram-publisher.ts 를 SocialProvider 인터페이스로 래핑.
 *
 * 기존 함수는 그대로 유지 (legacy 호환). 신규 코드는 Provider 인터페이스 사용 권장.
 */
import {
  publishCarouselToInstagram,
  checkPublishingLimit,
  getInstagramConfig,
  isInstagramConfigured,
} from '../instagram-publisher';
import { resolveMetaToken } from '../meta-token-resolver';
import type {
  SocialProvider,
  PublishInput,
  PublishResult,
  QuotaStatus,
  ProviderMetrics,
} from './types';

export class InstagramProvider implements SocialProvider {
  readonly platform = 'instagram' as const;

  isConfigured(): boolean {
    return isInstagramConfigured();
  }

  validate(input: PublishInput) {
    if (!input.mediaUrls || input.mediaUrls.length < 2 || input.mediaUrls.length > 10) {
      return { ok: false as const, error: `IG 캐러셀 2~10장 필요 (현재 ${input.mediaUrls?.length ?? 0}장)` };
    }
    if (input.text && input.text.length > 2200) {
      return { ok: false as const, error: `캡션 2200자 초과 (${input.text.length}자)` };
    }
    return { ok: true as const };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const cfg = await getInstagramConfig();
    if (!cfg) return { ok: false, step: 'config', error: 'IG 토큰/user_id 미설정' };

    const validation = this.validate!(input);
    if (!validation.ok) return { ok: false, step: 'validate', error: validation.error };

    const result = await publishCarouselToInstagram({
      igUserId: cfg.igUserId,
      accessToken: cfg.accessToken,
      imageUrls: input.mediaUrls!,
      caption: input.text,
    });
    return {
      ok: result.ok,
      postId: result.postId,
      error: result.error,
      step: result.step,
    };
  }

  async checkQuota(): Promise<QuotaStatus | null> {
    const cfg = await getInstagramConfig();
    if (!cfg) return null;
    const quota = await checkPublishingLimit(cfg.igUserId, cfg.accessToken);
    if (!quota) return null;
    return { used: quota.quotaUsed, limit: quota.quotaLimit, windowHours: 24 };
  }

  async fetchMetrics(externalId: string): Promise<ProviderMetrics | null> {
    const token = await resolveMetaToken('META_ACCESS_TOKEN');
    if (!token) return null;
    try {
      const metricList = ['views', 'reach', 'saved', 'likes', 'comments', 'shares'].join(',');
      const url = `https://graph.facebook.com/v21.0/${externalId}/insights?metric=${metricList}&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const entries = (data?.data ?? []) as Array<{ name: string; values: Array<{ value: number }> }>;
      const get = (name: string) => entries.find(e => e.name === name)?.values?.[0]?.value ?? undefined;
      return {
        views: get('views'),
        reach: get('reach'),
        saves: get('saved'),
        likes: get('likes'),
        comments: get('comments'),
        shares: get('shares'),
        raw: data,
      };
    } catch {
      return null;
    }
  }
}
