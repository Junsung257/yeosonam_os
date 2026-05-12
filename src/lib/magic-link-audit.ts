/**
 * 매직링크 감사 로그 기록 — magic_link_audit 테이블.
 *
 * 모든 이벤트(mint/confirm/consume/expire/revoke/verify_fail/rate_limited/session_issue)를
 * 단일 진입점으로 흘려서 누락 방지. 실패해도 throw 하지 않음 (logging 실패가 액션 차단 X).
 */

import { supabaseAdmin } from '@/lib/supabase';
import type { MagicActionType } from '@/lib/magic-link';

export type MagicAuditEvent =
  | 'mint'
  | 'confirm'
  | 'consume'
  | 'expire'
  | 'revoke'
  | 'verify_fail'
  | 'rate_limited'
  | 'session_issue'
  | 'session_verify_fail';

export interface MagicAuditInput {
  tokenId?: string | null;
  actionType?: MagicActionType;
  event: MagicAuditEvent;
  ip?: string;
  ua?: string;
  recipientHash?: string | null;
  metadata?: Record<string, unknown>;
  success?: boolean;
}

export async function recordMagicLinkAudit(input: MagicAuditInput): Promise<void> {
  try {
    await supabaseAdmin.from('magic_link_audit').insert({
      token_id: input.tokenId ?? null,
      action_type: input.actionType ?? null,
      event: input.event,
      ip: input.ip ? input.ip.slice(0, 64) : null,
      ua: input.ua ? input.ua.slice(0, 256) : null,
      recipient_hash: input.recipientHash ?? null,
      metadata: input.metadata ?? {},
      success: input.success !== false,
    } as never);
  } catch (err) {
    // Audit 실패는 비즈니스 액션을 차단하지 않음. 단 콘솔에 남김.
    console.warn('[magic-link-audit] insert failed:', (err as Error).message);
  }
}
