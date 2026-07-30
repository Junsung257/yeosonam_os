import type { ThreadsInboxItem, ThreadsPolicyResult } from './types';

const PROMPT_INJECTION =
  /ignore (all|any|the|previous)|system prompt|developer message|jailbreak|프롬프트|지시를 무시|규칙을 무시|이전 지침|비밀을 알려|api[\s_-]?key|access[\s_-]?token/i;
const PERSONAL_DATA =
  /(?:\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b)|(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)|(?:주민등록번호|여권번호|카드번호|계좌번호|비밀번호)/i;
const BOOKING_OR_PAYMENT =
  /예약|결제|입금|환불|취소|(?:일정|날짜)(?:을|를)?\s*(?:변경|바꾸)|차지백|영수증|바우처|청약\s*철회|여권\s*(확정|발급)|재고|잔여석|출발\s*확정/i;
const COMPLAINT_OR_DISPUTE =
  /사기|신고|고소|소송|분쟁|보상|최악|먹튀|연락\s*안|책임져|피해|소비자원/i;
const REGULATED_ADVICE =
  /약국|병원|약\s*(먹|복용)|임신|질병|비자\s*(보장|확정)|법률|세금|보험금/i;
const UNSAFE_LANGUAGE = /죽어|살해|폭탄|테러|자해|극단적\s*선택/i;
const URL_PATTERN = /https?:\/\/|www\.|(?:bit\.ly|tinyurl\.com|t\.co)\//gi;
const SPAM_PATTERN =
  /서로\s*맞팔|맞팔\s*환영|수익\s*보장|무료\s*코인|텔레그램|카톡\s*오픈채팅|오픈채팅방|선착순\s*\d+\s*명/i;

export function redactThreadsPersonalData(text: string): string {
  return text
    .replace(/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '[REDACTED_PHONE]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED_NUMBER]')
    .slice(0, 1000);
}

export function classifyThreadsInboxItem(
  item: Pick<ThreadsInboxItem, 'text' | 'username'>,
  myUsername?: string,
): ThreadsPolicyResult {
  const text = item.text.trim();
  if (!text) return { decision: 'skip', reason: 'empty' };
  if (
    myUsername &&
    item.username.trim().toLowerCase() === myUsername.trim().toLowerCase()
  ) {
    return { decision: 'skip', reason: 'self_authored' };
  }
  if (PROMPT_INJECTION.test(text)) {
    return { decision: 'skip', reason: 'prompt_injection' };
  }
  if (PERSONAL_DATA.test(text)) {
    return { decision: 'escalate', reason: 'personal_data' };
  }
  if (BOOKING_OR_PAYMENT.test(text)) {
    return { decision: 'escalate', reason: 'booking_or_payment' };
  }
  if (COMPLAINT_OR_DISPUTE.test(text)) {
    return { decision: 'escalate', reason: 'complaint_or_dispute' };
  }
  if (REGULATED_ADVICE.test(text)) {
    return { decision: 'escalate', reason: 'regulated_advice' };
  }
  if (UNSAFE_LANGUAGE.test(text)) {
    return { decision: 'escalate', reason: 'unsafe_language' };
  }

  const urls = text.match(URL_PATTERN)?.length ?? 0;
  if (urls > 1 || SPAM_PATTERN.test(text)) {
    return { decision: 'skip', reason: 'spam' };
  }

  const isQuestion = /[?？]|어디|언제|어떻게|얼마|추천|가능|좋을까|궁금/.test(text);
  return {
    decision: 'reply',
    reason: 'safe_conversation',
    fallbackReply: isQuestion
      ? '좋은 질문이에요. 여행지와 희망 날짜, 인원을 남겨주시면 공개적으로 안내 가능한 범위에서 도와드릴게요 😊'
      : '따뜻한 반응 감사합니다 😊 다음 여행 정보도 알차게 준비해볼게요.',
  };
}

export function validateGeneratedThreadsReply(text: string): string | null {
  const value = text.trim();
  if (!value) return 'empty_reply';
  if (value.length > 300) return 'reply_too_long';
  if (PERSONAL_DATA.test(value)) return 'personal_data';
  if (/https?:\/\/|www\./i.test(value)) return 'unexpected_url';
  if (
    /100\s*%|무조건|확실히|보장|예약\s*완료|환불\s*완료|출발\s*확정|재고\s*확보|최저가\s*보장/i.test(
      value,
    )
  ) {
    return 'unsupported_promise';
  }
  if (PROMPT_INJECTION.test(value)) return 'unsafe_instruction_echo';
  return null;
}
