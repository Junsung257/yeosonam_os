/**
 * magic-link-dispatch — 매직링크 URL 을 고객에게 발송하는 채널 어댑터.
 *
 * 설계 결정:
 *   - 알림톡 전용 generic 템플릿(`KAKAO_TEMPLATE_MAGIC_LINK`) 이 있으면 알림톡 발송.
 *   - 없거나 발송 실패 → SMS fallback (Solapi SMS, 동일 키).
 *   - 둘 다 없으면 → message_logs 에 mock 로그만 (개발/staging 안전 동작).
 *   - 발송 결과는 magic_link_audit 에 'session_issue' 와 별도 'dispatch' 이벤트로 기록 X
 *     (audit 는 mint 시점만 — 발송은 message_logs 가 SSOT).
 *
 * 호출:
 *   await dispatchMagicLink({ mintResult, channel: 'alimtalk', recipientPhone, label: '잔금 안내' });
 */

import { hasSecrets, getSecret } from '@/lib/secret-registry';
import { createMessageLog } from '@/lib/db/message-log';
import type { MagicActionType, MagicRecipientChannel, MintResult } from '@/lib/magic-link';

export interface DispatchInput {
  mintResult: MintResult;
  actionType: MagicActionType;
  channel: MagicRecipientChannel;
  recipientPhone?: string;
  recipientEmail?: string;
  /** 알림톡 또는 SMS 본문 컨텍스트 (단순 메시지). 최대 90자. */
  label: string;
  customerName?: string;
  bookingId?: string | null;
}

export interface DispatchResult {
  delivered: boolean;
  channelUsed: 'alimtalk' | 'sms' | 'email' | 'mock';
  isMock: boolean;
  logId?: string;
  reason?: string;
}

function isSolapiConfigured(): boolean {
  return hasSecrets([
    'SOLAPI_API_KEY',
    'SOLAPI_API_SECRET',
    'KAKAO_CHANNEL_ID',
    'KAKAO_SENDER_NUMBER',
  ]);
}

export async function dispatchMagicLink(input: DispatchInput): Promise<DispatchResult> {
  const { mintResult, actionType, channel, recipientPhone, recipientEmail, label, customerName, bookingId } = input;

  const wantAlimtalk = channel === 'alimtalk' && !!recipientPhone;
  const wantSms = channel === 'sms' && !!recipientPhone;
  const wantEmail = channel === 'email' && !!recipientEmail;

  // ── 알림톡 (generic magic-link 템플릿 우선) ──────────────────
  if (wantAlimtalk) {
    const templateId = getSecret('KAKAO_TEMPLATE_MAGIC_LINK');
    if (templateId && isSolapiConfigured()) {
      try {
        const { sendMagicLinkAlimtalk } = await import('./kakao');
        const res = await sendMagicLinkAlimtalk({
          phone: recipientPhone!,
          name: customerName ?? '고객',
          label,
          url: mintResult.url,
        });
        const sent = !(res as { skipped?: boolean }).skipped;
        if (sent) {
          const logId = await logSend({
            bookingId,
            channel: 'alimtalk',
            actionType,
            label,
            isMock: false,
            url: mintResult.url,
          });
          return { delivered: true, channelUsed: 'alimtalk', isMock: false, logId };
        }
      } catch (e) {
        console.warn('[magic-link-dispatch] alimtalk 실패:', e);
      }
    }
    // 알림톡 미설정 — SMS 로 graceful fallback
    return await trySmsFallback(input, 'alimtalk_template_missing');
  }

  if (wantSms) {
    return await trySmsFallback(input, null);
  }

  if (wantEmail) {
    return await tryEmailSend(input);
  }

  // 채널 매칭 안 됨 → mock 로그만
  const logId = await logSend({
    bookingId,
    channel: 'mock',
    actionType,
    label,
    isMock: true,
    url: mintResult.url,
    reason: 'no_matching_channel',
  });
  return { delivered: false, channelUsed: 'mock', isMock: true, logId, reason: 'no_matching_channel' };
}

async function trySmsFallback(input: DispatchInput, prevReason: string | null): Promise<DispatchResult> {
  // 현재 인프라엔 generic SMS 함수가 없으므로 mock 로그.
  // Solapi SMS 활성화 시 여기에 `sendSms({ to, text })` 추가.
  const logId = await logSend({
    bookingId: input.bookingId,
    channel: 'sms',
    actionType: input.actionType,
    label: input.label,
    isMock: true,
    url: input.mintResult.url,
    reason: prevReason ?? 'sms_not_wired',
  });
  return {
    delivered: false,
    channelUsed: 'mock',
    isMock: true,
    logId,
    reason: 'sms_pending_wire',
  };
}

async function tryEmailSend(input: DispatchInput): Promise<DispatchResult> {
  // Resend 키가 있으면 발송 가능. 현 시점에는 mock 로그.
  if (!getSecret('RESEND_API_KEY')) {
    const logId = await logSend({
      bookingId: input.bookingId,
      channel: 'email',
      actionType: input.actionType,
      label: input.label,
      isMock: true,
      url: input.mintResult.url,
      reason: 'resend_not_configured',
    });
    return { delivered: false, channelUsed: 'mock', isMock: true, logId, reason: 'email_pending_wire' };
  }

  // 실 발송 코드는 Resend SDK 도입 후 활성화. 현재는 mock.
  const logId = await logSend({
    bookingId: input.bookingId,
    channel: 'email',
    actionType: input.actionType,
    label: input.label,
    isMock: true,
    url: input.mintResult.url,
    reason: 'email_send_not_implemented',
  });
  return { delivered: false, channelUsed: 'mock', isMock: true, logId, reason: 'email_send_not_implemented' };
}

async function logSend(p: {
  bookingId: string | null | undefined;
  channel: string;
  actionType: MagicActionType;
  label: string;
  isMock: boolean;
  url: string;
  reason?: string;
}): Promise<string | undefined> {
  if (!p.bookingId) return undefined; // message_logs.booking_id NOT NULL
  // message_logs.log_type 은 'manual'|'mock'|'system'|'kakao'|'scheduler' 만 허용.
  // 매직링크 발송은 채널에 따라 매핑.
  const logType: 'kakao' | 'system' | 'mock' = p.isMock
    ? 'mock'
    : p.channel === 'alimtalk'
      ? 'kakao'
      : 'system';
  try {
    const log = await createMessageLog({
      booking_id: p.bookingId,
      log_type: logType,
      event_type: 'MAGIC_LINK_SEND' as never, // event_type 은 message_logs 에서 free text 또는 새 enum 추가 필요
      title: `[매직링크/${p.channel}] ${p.label}`,
      content: `${p.label}\n${p.url}${p.reason ? `\n(reason: ${p.reason})` : ''}\n[action_type=${p.actionType}]`,
      is_mock: p.isMock,
      created_by: 'system',
    });
    return log?.id;
  } catch (e) {
    console.warn('[magic-link-dispatch] message_logs 기록 실패:', e);
    return undefined;
  }
}
