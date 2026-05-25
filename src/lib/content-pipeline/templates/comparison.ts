import { TemplateDefinition, TemplateSection } from './index';

/**
 * A vs B 비교형 템플릿
 *
 * "다낭 vs 나트랑", "세부 vs 보홀" 등
 * 두 대상의 비교 분석에 최적화.
 * H2: "가격 비교", "일정 비교", "추천 대상".
 * 키워드에 "vs", "비교", "차이"가 포함될 때 활성화.
 */
export const comparisonTemplate: TemplateDefinition = {
  id: 'comparison',
  name: 'A vs B 비교',
  description: '비교 분석 — 두 여행지/상품/옵션의 장단점 대조',
  intentPatterns: [
    /\bvs\b/i,
    /비교/i,
    /차이/i,
    /다른\s*점/i,
    /어디가\s*더/i,
    /vs\s*/,
  ],
  buildSections(keyword: string): TemplateSection[] {
    return [
      {
        h2: `[각각의 매력 포인트]`,
        prompt: `${keyword} — 두 옵션의 각기 다른 매력과 강점을 소개. 어떤 점이 다른지 한눈에 비교.`,
        minWords: 80,
      },
      {
        h2: `[가격 & 일정 비교]`,
        prompt: `${keyword}의 가격대와 추천 일정을 비교. 예산과 시간에 따라 어떤 선택이 합리적인지 분석.`,
        minWords: 100,
      },
      {
        h2: `[볼거리 & 즐길 거리 비교]`,
        prompt: `${keyword}의 관광 명소와 액티비티를 주제별로 대조. 여행 스타일별 추천.`,
        minWords: 80,
      },
      {
        h2: `[이런 분들께 추천합니다]`,
        prompt: `${keyword} — 여행 스타일/연령대/목적별로 어떤 옵션이 더 적합한지 추천.`,
        minWords: 60,
      },
    ];
  },
};
