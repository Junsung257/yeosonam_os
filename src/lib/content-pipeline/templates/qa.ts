import { TemplateDefinition, TemplateSection } from './index';

/**
 * Q&A형 템플릿
 *
 * "다낭 여행 Q&A", "세부 자주 묻는 질문" 등
 * 각 H2가 질문 형태로 구성.
 * FAQ 최적화 — 롱테일 검색 유입 + FAQPage 리치 스니펫 목적.
 */
export const qaTemplate: TemplateDefinition = {
  id: 'qa',
  name: 'Q&A 형식',
  description: '질문+답변 — FAQ 중심 콘텐츠, 롱테일 검색 최적화',
  intentPatterns: [
    /Q\s*&?\s*A/i,
    /질문/i,
    /FAQ/i,
    /궁금/i,
    /자주\s*묻/i,
    /\?\s*$/,
  ],
  buildSections(keyword: string): TemplateSection[] {
    return [
      {
        h2: `[${keyword}, 언제 가는 게 좋을까?]`,
        prompt: `${keyword} 여행 최적 시즌 — 날씨/성수기/비수기 정보와 월별 추천 이유.`,
        minWords: 80,
      },
      {
        h2: `[${keyword} 여행, 얼마나 걸리나?]`,
        prompt: `${keyword} 추천 여행 기간 — 최소/권장 일정과 일별 추천 코스 요약.`,
        minWords: 60,
      },
      {
        h2: `[${keyword} 가려면 얼마나 들까?]`,
        prompt: `${keyword} 여행 비용 가이드 — 항공/숙소/식비/액티비티별 예산 추정.`,
        minWords: 80,
      },
      {
        h2: `[${keyword} 에서 꼭 해야 할 것은?]`,
        prompt: `${keyword}에서 놓치면 안 될 필수 체험과 명소 추천.`,
        minWords: 60,
      },
      {
        h2: `[${keyword} 여행, 위험하지 않을까?]`,
        prompt: `${keyword} 여행 안전 정보 — 주의사항, 사기/절도 예방 팁, 현지 연락처.`,
        minWords: 60,
      },
    ];
  },
};
