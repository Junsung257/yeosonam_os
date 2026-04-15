/**
 * 여소남 블로그 변형 풀 (매 글마다 다른 오프닝/클로징)
 *
 * 목적:
 *   - 사장님 네이버 블로그가 매 글 동일한 오프닝/클로징으로 복붙되는 문제 해결
 *   - Google의 "중복 콘텐츠" 페널티 방지
 *   - AI가 매번 같은 패턴으로 쓰는 것 방지
 *
 * 사용법:
 *   prompt 조립 시 pickRandom() 유틸로 각 풀에서 1개씩 선택 → Gemini에 주입
 */

export const BLOG_VARIATIONS = {
  /**
   * 인트로 오프닝 후킹 문장 (H1 다음 문단 시작 문장)
   * {dest}, {duration}, {price} 플레이스홀더 → 렌더링 시 치환
   */
  opening_hooks: [
    '{dest}로 떠나는 {duration} 여행, 지금 계획하고 계신가요?',
    '{duration} 동안 {dest}에서 알찬 추억을 만들고 싶다면?',
    '{dest} 패키지 상품이 너무 많아서 고르기 어려우시죠?',
    '{duration} 짧은 휴가로 {dest}를 제대로 즐기려면 어떤 상품이 좋을까요?',
    '부모님 모시고 떠나는 {dest} 여행, 동선과 식단이 걱정되시죠?',
    '아이와 함께하는 {dest} 여행, 피로도를 줄이면서 알차게 즐길 수 있는 상품을 찾고 계신다면?',
    '{dest} 여행 상품이 많아서 뭐가 진짜 가성비인지 헷갈리시는 분들을 위해 정리했습니다.',
    '{duration} 일정으로 {dest}를 제대로 경험하려면 어떤 코스를 골라야 할까요?',
    '{dest} 여행을 검토 중이시라면 이 글에서 핵심 정보를 3분 안에 확인하세요.',
    '부산 출발 {dest} 직항 상품 중 여소남이 엄선한 상품을 소개합니다.',
  ],

  /**
   * 긴급감 멘트 (중반~후반 섹션 끝)
   */
  urgency_lines: [
    '이번 출발일 기준 좌석이 빠르게 소진되고 있습니다.',
    '이 가격대 상품은 월 1~2회만 진행됩니다.',
    '출발 확정된 일정이라 조기 마감 가능성이 높습니다.',
    '여행사 기획전 특가로 진행되는 한정 상품입니다.',
    '5성급 숙박 포함 상품 중 이 가격대는 드문 편입니다.',
    '성수기 진입 전 출발편은 공급이 제한적입니다.',
    '동일 일정 중 가격 경쟁력이 높은 편입니다.',
    '전세기 또는 블록 좌석 상품으로 추가 증편이 어렵습니다.',
    '전년도 동일 상품은 출발 2주 전 조기 마감되었습니다.',
    '할인 프로모션 기간이 제한적이므로 일정 확정 시 빠른 확인을 권장합니다.',
  ],

  /**
   * CTA 전환 유도 문장 (마지막 CTA 버튼 직전)
   */
  cta_closers: [
    '일정이 맞으신다면 상품 상세 정보를 확인해 보세요.',
    '포함사항과 세부 일정은 상품 페이지에서 확인 가능합니다.',
    '궁금한 점은 카카오톡 상담으로 언제든 물어보세요.',
    '조기 예약 시 좌석 확보가 유리합니다.',
    '전체 출발일과 요금은 상품 상세 페이지에서 확인 가능합니다.',
    '상품 상세 정보에서 일정별 차이점을 비교해 보세요.',
    '이 상품에 대한 세부 문의는 여소남에 언제든 연락 주세요.',
    '일정을 확정하고 싶으시면 지금 상품 페이지로 이동하세요.',
    '최종 가격 확인은 출발일 선택 후 가능합니다.',
    '여소남에서 상품 상세를 확인하고 안심하고 비교해 보세요.',
  ],

  /**
   * CTA 버튼 텍스트
   */
  cta_button_labels: [
    '이 상품 상세 보기',
    '출발일별 요금 확인하기',
    '상품 자세히 보기',
    '예약 페이지로 이동',
    '{dest} 패키지 상세 보기',
    '일정 확인 및 예약',
    '상품 페이지 바로가기',
  ],
};

/**
 * 각 풀에서 랜덤 1개 선택
 */
export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 한 번의 블로그 생성에 사용할 변형 세트를 반환
 * (매 호출 다른 조합)
 */
export function pickBlogVariations(params: {
  dest?: string;
  duration?: string;
  price?: string;
}) {
  const { dest = '여행지', duration = '여행', price = '' } = params;
  const substitute = (template: string) =>
    template
      .replace(/\{dest\}/g, dest)
      .replace(/\{duration\}/g, duration)
      .replace(/\{price\}/g, price);

  return {
    opening_hook: substitute(pickRandom(BLOG_VARIATIONS.opening_hooks)),
    urgency_line: substitute(pickRandom(BLOG_VARIATIONS.urgency_lines)),
    cta_closer: substitute(pickRandom(BLOG_VARIATIONS.cta_closers)),
    cta_button_label: substitute(pickRandom(BLOG_VARIATIONS.cta_button_labels)),
  };
}
