/**
 * ThreadsProvider — threads-publisher.ts 를 SocialProvider 로 래핑.
 */
import {
  publishToThreads,
  checkThreadsPublishingLimit,
  getThreadsConfig,
  isThreadsConfigured,
} from '../threads-publisher';
import { resolveMetaToken } from '../meta-token-resolver';
import type {
  SocialProvider,
  PublishInput,
  PublishResult,
  QuotaStatus,
  ProviderMetrics,
} from './types';

export class ThreadsProvider implements SocialProvider {
  readonly platform = 'threads' as const;

  isConfigured(): boolean {
    return isThreadsConfigured();
  }

  validate(input: PublishInput) {
    if (!input.text || !input.text.trim()) return { ok: false as const, error: '본문 비어있음' };
    if (input.text.length > 500) return { ok: false as const, error: `본문 500자 초과 (${input.text.length}자)` };
    if (input.mediaUrls && input.mediaUrls.length > 20) return { ok: false as const, error: `이미지 20장 초과` };
    return { ok: true as const };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const cfg = await getThreadsConfig();
    if (!cfg) return { ok: false, step: 'config', error: 'Threads 토큰/user_id 미설정' };

    const validation = this.validate!(input);
    if (!validation.ok) return { ok: false, step: 'validate', error: validation.error };

    const result = await publishToThreads({
      threadsUserId: cfg.threadsUserId,
      accessToken: cfg.accessToken,
      text: input.text,
      imageUrls: input.mediaUrls && input.mediaUrls.length > 0 ? input.mediaUrls : undefined,
    });
    return {
      ok: result.ok,
      postId: result.postId,
      error: result.error,
      step: result.step,
    };
  }

  async checkQuota(): Promise<QuotaStatus | null> {
    const cfg = await getThreadsConfig();
    if (!cfg) return null;
    const quota = await checkThreadsPublishingLimit(cfg.threadsUserId, cfg.accessToken);
    if (!quota) return null;
    return { used: quota.quotaUsed, limit: quota.quotaLimit, windowHours: 24 };
  }

  async fetchMetrics(externalId: string): Promise<ProviderMetrics | null> {
    const token = (await resolveMetaToken('THREADS_ACCESS_TOKEN')) || (await resolveMetaToken('META_ACCESS_TOKEN'));
    if (!token) return null;
    try {
      const metricList = ['views', 'likes', 'replies', 'reposts', 'quotes'].join(',');
      const url = `https://graph.threads.net/v1.0/${externalId}/insights?metric=${metricList}&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const entries = (data?.data ?? []) as Array<{ name: string; values: Array<{ value: number }> }>;
      const get = (name: string) => entries.find(e => e.name === name)?.values?.[0]?.value ?? undefined;
      return {
        views: get('views'),
        likes: get('likes'),
        replies: get('replies'),
        reposts: get('reposts'),
        quotes: get('quotes'),
        raw: data,
      };
    } catch {
      return null;
    }
  }
}
