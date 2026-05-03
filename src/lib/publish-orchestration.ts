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
