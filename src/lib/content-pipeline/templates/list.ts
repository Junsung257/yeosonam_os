import { TemplateDefinition, TemplateSection } from './index';

/**
 * TOP N 리스트형 템플릿
 *
 * "다낭 TOP 5 호텔", "보홀 BEST 3 액티비티" 등
 * H2가 "1. [항목]", "2. [항목]" 형태로 구성.
 * 숫자·순위형 콘텐츠에 최적화.
 */
export const listTemplate: TemplateDefinition = {
  id: 'list',
  name: 'TOP N 리스트',
  description: '순위/리스트형 — "TOP 5", "BEST 3", "N가지 꿀팁" 스타일',
  intentPatterns: [
    /top\s*\d+/i,
    /best\s*\d*/i,
    /최고/i,
    /베스트/i,
    /추천\s*top/i,
    /\d+가지/,
    /\d+선/,
  ],
  buildSections(keyword: string): TemplateSection[] {
    const items = [
      `${keyword} 첫 번째 추천`,
      `${keyword} 두 번째 추천`,
      `${keyword} 세 번째 추천`,
      `${keyword} 네 번째 추천`,
      `${keyword} 다섯 번째 추천`,
    ];

    return items.slice(0, 5).map((item, idx) => ({
      h2: `${idx + 1}. [${item}]`,
      prompt: `${item}에 대한 상세 소개 — 선정 이유, 특징, 가격대(해당 시), 방문 팁을 4~6문장으로.`,
      minWords: 60,
    }));
  },
};
