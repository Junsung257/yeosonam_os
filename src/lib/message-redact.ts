/**
 * 플랫폼 학습용 경량 마스킹 — 전문 저장 시 PII 노출 완화
 * (법적 완전성 X — 계약·동의 레이어와 함께 쓸 것)
 */

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_KR =
  /\b(?:0?1[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}\b|\b010[-.\s]?\d{4}[-.\s]?\d{4}\b/g;
const RRN_LIKE = /\b\d{6}[-.\s]?\d{7}\b/g;
const CARD_16 = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;

const MAX_LEN = 4000;

/**
 * 마스킹된 문자열 (학습·분석용). 원문이 비어 있으면 null.
 */
export function redactForPlatformLearning(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let s = t.slice(0, MAX_LEN);
  s = s.replace(RRN_LIKE, '[주민-like]');
  s = s.replace(CARD_16, '[카드번호]');
  s = s.replace(PHONE_KR, '[전화]');
  s = s.replace(EMAIL, '[이메일]');
  return s;
}
