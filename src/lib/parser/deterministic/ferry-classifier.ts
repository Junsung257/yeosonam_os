/**
 * @file deterministic/ferry-classifier.ts — Ferry/Cruise 자동 분류 (2026-05-14 박제)
 *
 * 박제 사유:
 *   부관훼리·카멜리아 같은 선박 상품이 LLM 단일 prompt 에서 항공편으로 잘못 분류되어
 *   모바일 모든 day 에 "후쿠오카 ✈ 부산" 환각 헤더가 박히던 사고. render-contract.ts 의
 *   isFerryPackage 와 같은 키워드 set 을 parser 단계에서도 미리 적용하여 product_type 강제.
 *
 * 효과: ferry 분류 결정적 100%, LLM 호출 0 (무료, 즉시).
 */

const FERRY_KEYWORDS = [
  '부관훼리', '뉴카멜리아', '카멜리아',
  '훼리', '페리', '선박', '크루즈',
  'cruise', 'ferry',
];

const FERRY_RE = new RegExp(FERRY_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

/**
 * 원문 + title 에서 ferry/cruise 키워드를 감지. 매칭되면 product_type='cruise' 강제.
 *   - title 우선 (사장님 카탈로그 첫 줄에 "[부관훼리] 무박3일" 같은 명시가 많음)
 *   - 본문 첫 500자 (header 영역 — 선박명/스케쥴 표기가 보통 여기)
 */
export function detectFerry(rawText: string, title?: string): {
  isFerry: boolean;
  matchedKeyword: string | null;
  ferryName: string | null;
} {
  const head = (title ?? '') + '\n' + (rawText ?? '').slice(0, 800);
  const m = head.match(FERRY_RE);
  if (!m) return { isFerry: false, matchedKeyword: null, ferryName: null };

  // ferry name 우선순위: 부관훼리/카멜리아/뉴카멜리아 같이 명시적 → 그 자체. 일반 "훼리/페리/크루즈" → null
  const SPECIFIC = ['부관훼리', '뉴카멜리아', '카멜리아'];
  const specificM = head.match(new RegExp(SPECIFIC.join('|')));
  return {
    isFerry: true,
    matchedKeyword: m[0],
    ferryName: specificM ? specificM[0] : null,
  };
}
