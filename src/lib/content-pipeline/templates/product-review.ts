import { TemplateDefinition, TemplateSection } from './index';

/**
 * 상품 리뷰형 템플릿
 *
 * "다낭 3박 4일 패키지 후기", "보홀 자유여행 상품 비교" 등
 * 패키지 상품·투어·여행사 제품 리뷰에 최적화.
 * 상업적 의도(commercial) 키워드에 활성화.
 */
export const productReviewTemplate: TemplateDefinition = {
  id: 'product-review',
  name: '상품 리뷰',
  description: '패키지/투어/상품 리뷰 — 가격·일정·총평으로 구성',
  intentPatterns: [
    /리뷰/i,
    /후기/i,
    /패키지/i,
    /상품/i,
    /투어\s*추천/i,
    /가격\s*대비/i,
    /가성비/i,
  ],
  buildSections(keyword: string): TemplateSection[] {
    return [
      {
        h2: `[상품 개요 — ${keyword}는 어떤 상품일까?]`,
        prompt: `${keyword} 상품의 기본 정보 — 여행사, 기간, 포함 항목, 가격대 개요.`,
        minWords: 80,
      },
      {
        h2: `[${keyword} 여행 일정 살펴보기]`,
        prompt: `${keyword}의 일자별 상세 일정 — 주요 방문지, 숙소, 이동 수단.`,
        minWords: 100,
      },
      {
        h2: `[${keyword} 가격 분석 & 숨은 비용]`,
        prompt: `${keyword} 가격에 포함된 것과 포함되지 않은 것 — 옵션 비용, 팁, 쇼핑 등 예상 추가 비용.`,
        minWords: 80,
      },
      {
        h2: `[${keyword} — 이런 분들께 추천]`,
        prompt: `${keyword}가 적합한 여행자 유형과 반대의 경우 대안 추천.`,
        minWords: 60,
      },
      {
        h2: `[${keyword} 총평 & 별점]`,
        prompt: `${keyword}에 대한 종합 평가 — 장점, 단점, 총점(5점 만점)과 추천 이유.`,
        minWords: 80,
      },
    ];
  },
};
