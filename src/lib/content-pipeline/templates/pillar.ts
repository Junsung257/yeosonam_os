import { TemplateDefinition, TemplateSection } from './index';

/**
 * 완전 가이드 (Pillar) 템플릿
 *
 * 기존 기본 스타일 — 종합 가이드 성격의 글.
 * H2 제목을 대괄호 스타일(`[주제]`)로 구성.
 * 변경 없이 기존 동작을 유지한다.
 */
export const pillarTemplate: TemplateDefinition = {
  id: 'pillar',
  name: '완전 가이드',
  description: '종합 가이드 — destination/제품 전반을 다루는 pillar 콘텐츠',
  intentPatterns: [
    /가이드/i,
    /정보/i,
    /완벽/i,
    /총정리/i,
    /모든 것/i,
    /정리/i,
  ],
  buildSections(keyword: string): TemplateSection[] {
    return [
      {
        h2: `[${keyword} 여행, 왜 주목받을까?]`,
        prompt: `${keyword} 여행이 주목받는 이유 — 최신 트렌드와 여행 수요 배경을 4~6문장으로 설명.`,
        minWords: 60,
      },
      {
        h2: `[${keyword} 가기 전에 알면 좋은 정보]`,
        prompt: `${keyword} 여행을 준비할 때 알아두면 좋은 기본 정보 (날씨/비자/시차/환전).`,
        minWords: 80,
      },
      {
        h2: `[${keyword} 주요 관광 명소 & 액티비티]`,
        prompt: `${keyword}에서 꼭 방문해야 할 명소와 추천 액티비티 3~5곳을 구체적으로 소개.`,
        minWords: 100,
      },
      {
        h2: `[${keyword} 맛집 & 현지 음식]`,
        prompt: `${keyword}에서 놓치면 아쉬운 현지 맛집과 추천 메뉴를 소개.`,
        minWords: 80,
      },
      {
        h2: `[${keyword} 여행 준비물 & 꿀팁]`,
        prompt: `${keyword} 여행 시 챙기면 좋은 준비물과 실전에서 활용할 수 있는 꿀팁 5가지.`,
        minWords: 80,
      },
    ];
  },
};
