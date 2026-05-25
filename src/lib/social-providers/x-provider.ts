/**
 * XProvider — Twitter API v2 발행.
 *
 * OAuth 2.0 Bearer Token 방식 (read-only) 은 뼈대만.
 * 실제 발행은 OAuth 1.0a (user context) 가 필요하므로 현재는
 * publishToTwitter() 를 OAuth 2.0 으로 fallback 하고,
 * 추후 Twitter API OAuth 1.0a / OAuth 2.0 PKCE 로 전환.
 *
 * 환경변수: X_BEARER_TOKEN (read) / X_API_KEY + X_API_SECRET (write, 향후)
 */
import crypto from 'crypto';
import type {
  SocialProvider,
  PublishInput,
  PublishResult,
  QuotaStatus,
  ProviderMetrics,
} from './types';

export class XProvider implements SocialProvider {
  readonly platform = 'x' as const;

  isConfigured(): boolean {
    return !!(process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN);
  }

  validate(input: PublishInput) {
    if (!input.text || !input.text.trim()) return { ok: false as const, error: '본문 비어있음' };
    if (input.text.length > 280) return { ok: false as const, error: `트윗 280자 초과 (${input.text.length}자)` };
    // X API v2: 이미지 업로드는 /2/media/upload 별도 호출 필요 (아직 미구현)
    if (input.mediaUrls && input.mediaUrls.length > 4) return { ok: false as const, error: `이미지 4장 초과` };
    return { ok: true as const };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const validation = this.validate!(input);
    if (!validation.ok) return { ok: false, step: 'validate', error: validation.error };

    const bearerToken = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;

    if (!bearerToken) {
      return { ok: false, step: 'config', error: 'X Bearer Token 미설정' };
    }

    try {
      // 텍스트만 발행 (이미지 업로드는 OAuth 1.0a 필요)
      const body: Record<string, unknown> = { text: input.text };

      const res = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        // OAuth 2.0 Bearer Token 은 write 권한이 없으므로 예상된 실패
        // OAuth 1.0a fallback 시도
        return { ok: false, step: 'publish', error: `Twitter API 오류: ${data?.title || res.status} — ${data?.detail || JSON.stringify(data)}` };
      }

      return {
        ok: true,
        postId: data?.data?.id,
        permalink: data?.data?.id ? `https://x.com/i/status/${data.data.id}` : undefined,
      };
    } catch (err) {
      return { ok: false, step: 'publish', error: err instanceof Error ? err.message : '알 수 없는 오류' };
    }
  }

  async checkQuota(): Promise<QuotaStatus | null> {
    const bearerToken = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
    if (!bearerToken) return null;

    try {
      // X API v2 에는 공식 quota endpoint 가 없으므로 null 반환
      return null;
    } catch {
      return null;
    }
  }

  async fetchMetrics(externalId: string): Promise<ProviderMetrics | null> {
    const bearerToken = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN;
    if (!bearerToken) return null;

    try {
      const res = await fetch(`https://api.twitter.com/2/tweets/${externalId}?tweet.fields=public_metrics`, {
        headers: { 'Authorization': `Bearer ${bearerToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const m = data?.data?.public_metrics;
      if (!m) return null;

      return {
        likes: m.like_count ?? undefined,
        replies: m.reply_count ?? undefined,
        reposts: m.retweet_count ?? undefined,
        quotes: m.quote_count ?? undefined,
        views: m.impression_count ?? undefined,
        raw: data,
      };
    } catch {
      return null;
    }
  }
}
