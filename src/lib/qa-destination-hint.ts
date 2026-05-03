/**
 * QA 채팅·자유여행 CTA 등에서 쓰는 **짧은 목적지 키워드** 매칭.
 * (정규화된 목적지 마스터와 다를 수 있음 — 없으면 전체 상품 컨텍스트로 폴백)
 */
export const QA_KNOWN_DESTINATION_KEYWORDS = [
  '다낭', '나트랑', '푸꾸옥', '하노이', '호치민',
  '오사카', '도쿄', '후쿠오카', '훗카이도', '교토', '시즈오카', '나고야',
  '방콕', '푸켓', '파타야', '치앙마이',
  '싱가포르', '홍콩', '마카오', '타이베이',
  '발리', '세부', '보라카이', '괌', '사이판',
  '파리', '런던', '로마', '바르셀로나', '프라하',
  '뉴욕', '하와이', '라스베가스', '시안', '장가계',
] as const;

/** 본문에 알려진 목적지 키워드가 있으면 첫 매칭만 반환 */
export function extractQaDestinationHint(text: string): string | null {
  if (!text?.trim()) return null;
  for (const dest of QA_KNOWN_DESTINATION_KEYWORDS) {
    if (text.includes(dest)) return dest;
  }
  return null;
}

/**
 * 현재 질문 + 최근 고객 발화 몇 줄을 합쳐 목적지 힌트 추출 (후속 턴에서 "거기"만 쳐도 이전 목적지 반영).
 */
export function buildQaPackageHintSource(
  message: string,
  history: { role: string; content: string }[] = [],
  maxUserLines = 3,
): string {
  const lines: string[] = [message.trim()];
  for (let i = history.length - 1; i >= 0 && lines.length < maxUserLines; i--) {
    const m = history[i];
    if (m?.role === 'user' && typeof m.content === 'string') {
      const t = m.content.trim();
      if (t) lines.push(t);
    }
  }
  return lines.join('\n');
}
