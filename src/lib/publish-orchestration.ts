import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

/**
 * 멀티채널 발행(블로그·IG·스레드) 사가/보상 — 확장용 타입만 두고
 * 실제 보상 트랜잭션은 채널별 API·정책 확정 후 연동.
 */
export type PublishChannel = 'blog' | 'instagram' | 'threads' | 'naver_blog';

export interface PublishOrchestrationAttempt {
  id: string;
  cardNewsId?: string | null;
  contentCreativeId?: string | null;
  startedAt: string;
  channels: Partial<Record<PublishChannel, 'pending' | 'ok' | 'failed'>>;
}

/** v0: 로그만 — 이후 content_distributions / marketing_logs 와 연계 */
export function logPublishOrchestrationStub(attempt: PublishOrchestrationAttempt): void {
  if (process.env.PUBLISH_ORCHESTRATION_DEBUG === '1') {
    console.log('[publish-orchestration]', JSON.stringify(attempt));
  }
}

/**
 * 자동 발행 성공 로그를 marketing_logs 에 남긴다.
 * - 향후 멀티채널 사가(content_distributions) 확장 전까지 최소 추적 지점.
 */
export async function recordAutoPublishLog(params: {
  platform: 'blog' | 'instagram' | 'threads';
  url: string;
  productId?: string | null;
  travelPackageId?: string | null;
}): Promise<void> {
  const enabled =
    process.env.PUBLISH_ORCHESTRATION_WRITE_LOGS === '1' ||
    process.env.PUBLISH_ORCHESTRATION_WRITE_LOGS === 'true';
  if (!enabled) return;
  if (!isSupabaseConfigured || !params.url) return;
  await supabaseAdmin.from('marketing_logs').insert({
    product_id: params.productId ?? null,
    travel_package_id: params.travelPackageId ?? null,
    platform: params.platform,
    url: params.url,
  });
}
