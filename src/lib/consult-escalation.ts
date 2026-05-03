/**
 * 고객 QA 채팅 → 인간 상담(전화·카톡) 에스컬레이션
 *
 * - 카톡: NEXT_PUBLIC_KAKAO_CHANNEL_ID + kakaoChannel.openKakaoChannel (기존 단일 소스)
 * - 전화: NEXT_PUBLIC_CONSULT_PHONE 설정 시에만 tel: 동작 (미설정이면 UI에서 버튼 숨김)
 */

import type { ChatMessage } from '@/lib/chat-store';
import { openKakaoChannel } from '@/lib/kakaoChannel';

/** 하이픈·괄호·공백 허용, 숫자(선행 + 포함)만 추려 tel: 생성 */
export function getConsultTelHref(): string | null {
  const raw = process.env.NEXT_PUBLIC_CONSULT_PHONE?.trim();
  if (!raw) return null;
  const compact = raw.replace(/[^\d+]/g, '');
  if (!/^\+?\d{8,15}$/.test(compact)) return null;
  if (compact.includes('+') && !compact.startsWith('+')) return null;
  return `tel:${compact}`;
}

export function hasConsultPhoneConfigured(): boolean {
  return getConsultTelHref() != null;
}

export function openConsultPhone(): boolean {
  const href = getConsultTelHref();
  if (!href) return false;
  window.location.href = href;
  return true;
}

const MAX_USER_LINES = 4;
const MAX_LINE_CHARS = 280;

/** 최근 사용자 메시지 일부를 카톡 붙여넣기 문맥으로 */
export function buildEscalationSummaryFromMessages(messages: ChatMessage[]): string {
  const userTexts = messages
    .filter((m) => m.role === 'user' && (m.type === undefined || m.type === 'text'))
    .map((m) => m.content.trim())
    .filter(Boolean)
    .slice(-MAX_USER_LINES);

  if (userTexts.length === 0) return '';

  return userTexts
    .map((t) => (t.length > MAX_LINE_CHARS ? `${t.slice(0, MAX_LINE_CHARS)}…` : t))
    .join('\n---\n');
}

export async function openKakaoFromChatEscalation(messages: ChatMessage[]): Promise<void> {
  const escalationSummary = buildEscalationSummaryFromMessages(messages);
  await openKakaoChannel(
    escalationSummary ? { escalationSummary } : undefined,
  );
}

/** 에스컬레이션 버튼 클릭 — 서버에만 기록, 실패해도 UX 영향 없음 */
export function logEscalationCtaPick(params: {
  channel: 'phone' | 'kakao';
  sessionId: string;
  affiliateRef: string | null;
  path: string;
  /** 최근 사용자 메시지 요약 — 서버에서 길이 제한·PII 마스킹 후 qa_inquiries에 첨부 */
  conversationSummary?: string;
}): void {
  void fetch('/api/qa/escalation-cta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: params.channel,
      sessionId: params.sessionId,
      affiliateRef: params.affiliateRef,
      path: params.path,
      conversationSummary: params.conversationSummary,
    }),
  }).catch(() => {});
}
