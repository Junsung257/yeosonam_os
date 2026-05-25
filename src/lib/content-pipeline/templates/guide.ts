import { TemplateDefinition, TemplateSection } from './index';

/**
 * 방법/준비물 가이드형 템플릿
 *
 * "다낭 여행 준비 방법", "보홀 체크리스트" 등
 * H2가 "Step 1: ...", "Step 2: ..." 형태로 구성.
 * 단계별 설명이 필요한 콘텐츠에 최적화.
 */
export const guideTemplate: TemplateDefinition = {
  id: 'guide',
  name: '방법/준비물 가이드',
  description: 'Step-by-step — 준비 방법, 체크리스트, 단계별 가이드',
  intentPatterns: [
    /방법/i,
    /준비/i,
    /하는\s*법/i,
    /체크리스트/i,
    /step\s*\d+/i,
    /과정/i,
    /순서/i,
    /단계/i,
    /절차/i,
  ],
  buildSections(keyword: string): TemplateSection[] {
    return [
      {
        h2: `Step 1. [${keyword} — 사전 준비하기]`,
        prompt: `${keyword} 여행을 위한 필수 사전 준비 — 여권·비자·항공권·숙소 예약 순서와 팁.`,
        minWords: 80,
      },
      {
        h2: `Step 2. [${keyword} — 짐 싸기 & 준비물]`,
        prompt: `${keyword} 여행 시 챙겨야 할 필수 준비물 리스트와 짐 싸는 꿀팁.`,
        minWords: 80,
      },
      {
        h2: `Step 3. [${keyword} — 현지 도착 후 할 일]`,
        prompt: `${keyword} 도착 후 첫 24시간 — 공항→숙소 이동, 환전, 유심/와이파이 설치.`,
        minWords: 60,
      },
      {
        h2: `Step 4. [${keyword} — 추천 일정 소화하기]`,
        prompt: `${keyword}에서의 추천 여행 동선 — 일자별 코스와 이동 방법.`,
        minWords: 100,
      },
      {
        h2: `Step 5. [${keyword} — 귀국 & 마무리]`,
        prompt: `${keyword} 여행 마무리 — 출국 전 체크리스트, 면세 팁, 귀국 후 할 일.`,
        minWords: 60,
      },
    ];
  },
};
