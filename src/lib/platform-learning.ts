/**
 * 플랫폼 AI 플라이휠 — 대화/자비스 턴 신호 적재 (+옵션 마스킹 원문)
 *
 * - 기본: message_sha256 + payload (PII 최소화)
 * - PLATFORM_LEARNING_STORE_REDACTED_MESSAGE=true 이면 message_redacted 컬럼에 휴리스틱 마스킹 전문 저장
 * - tenant_id: Jarvis ctx / 향후 테넌트 UUID (제휴와 별도일 수 있음)
 */

import { createHash } from 'crypto';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { redactForPlatformLearning } from '@/lib/message-redact';

export type PlatformLearningSource =
  | 'qa_chat'
  | 'qa_escalation_cta'
  | 'jarvis_v1'
  | 'jarvis_v2_stream';

function sha256Normalized(text: string): string {
  const n = text.trim().replace(/\s+/g, ' ').toLowerCase();
  return createHash('sha256').update(n, 'utf8').digest('hex');
}

function shouldStoreRedacted(): boolean {
  return process.env.PLATFORM_LEARNING_STORE_REDACTED_MESSAGE === 'true';
}

/**
 * Fire-and-forget. 실패해도 사용자 응답에는 영향 없음.
 */
export function recordPlatformLearningEvent(params: {
  source: PlatformLearningSource;
  sessionId?: string | null;
  affiliateId?: string | null;
  /** 여행사 테넌트 등 (Jarvis ctx.tenantId) */
  tenantId?: string | null;
  userMessage: string;
  payload: Record<string, unknown>;
  consentFlags?: Record<string, unknown>;
}): void {
  if (!isSupabaseConfigured) return;

  const message_sha256 = params.userMessage.trim()
    ? sha256Normalized(params.userMessage)
    : null;

  const message_redacted = shouldStoreRedacted()
    ? redactForPlatformLearning(params.userMessage)
    : null;

  const row: Record<string, unknown> = {
    source: params.source,
    session_id: params.sessionId ?? null,
    affiliate_id: params.affiliateId ?? null,
    tenant_id: params.tenantId ?? null,
    message_sha256,
    payload: params.payload,
    consent_flags: params.consentFlags ?? {},
  };

  if (message_redacted) {
    row.message_redacted = message_redacted;
  }

  void supabaseAdmin
    .from('platform_learning_events')
    .insert(row)
    .then(
      (res: { error: { message: string } | null }) => {
        if (res.error) console.warn('[platform-learning] insert:', res.error.message);
      },
      (e: unknown) => console.warn('[platform-learning] insert exception:', e),
    );
}
