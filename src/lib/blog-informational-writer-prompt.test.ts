import { describe, expect, it } from 'vitest';
import { buildBlogContentBrief, buildBlogContentBriefPromptBlock } from './blog-content-brief';
import { buildInfoGuideBrief, buildInfoWriterPromptBlock } from './blog-editorial-voice';
import { buildBlogIntentPromptContract, classifyBlogIntent } from './blog-content-intent';
import { BLOG_INFORMATION_INTENTS } from './blog-information-contract';
import {
  auditInformationalWriterPrompt,
  buildInformationalDepthBlock,
  buildInformationalQualityBlock,
  buildInformationalWriterPrompt,
} from './blog-informational-writer-prompt';
import { BLOG_INFORMATION_WRITER_GUIDE } from '@/prompts/blog/informational-writer-guide';

const FIXTURES = {
  food_budget: ['삿포로 여행 식비', '삿포로', '삿포로 식비', 'food'],
  monthly_weather: ['괌 8월 날씨와 옷차림', '괌', '괌 8월 날씨', 'weather'],
  airport_transport: ['세부 공항에서 시내 이동', '세부', '세부 공항 교통', 'transport'],
  hotel_areas: ['괌 호텔 지역 비교', '괌', '괌 호텔 위치', 'hotel'],
  family_budget: ['보홀 가족여행 예산', '보홀', '보홀 가족여행 비용', 'cost'],
  itinerary: ['다낭 3박 4일 일정', '다낭', '다낭 여행 일정', 'itinerary'],
  shopping_souvenirs: ['괌 쇼핑 기념품 가이드', '괌', '괌 쇼핑', 'shopping'],
  currency_payment: ['발리 환전과 카드 결제', '발리', '발리 환전', 'currency'],
  entry_requirements: ['일본 입국 준비 서류', '일본', '일본 입국 서류', 'visa'],
  travel_insurance: ['태국 여행자보험 확인사항', '태국', '태국 여행자보험', 'insurance'],
} as const;

function buildFixturePrompt(intent: keyof typeof FIXTURES) {
  const [topic, destination, primaryKeyword, category] = FIXTURES[intent];
  const brief = buildBlogContentBrief({
    topic,
    destination,
    primaryKeyword,
    category,
    microAngle: intent,
    travelerNationality: intent === 'entry_requirements' ? 'KR' : null,
  });
  expect(brief.passed).toBe(true);
  expect(brief.intentType).toBe(intent);
  const intentContract = buildBlogIntentPromptContract(classifyBlogIntent({
    title: topic,
    primaryKeyword,
    category,
    angleType: intent,
    contentType: 'guide',
  }));
  return buildInformationalWriterPrompt({
    guide: BLOG_INFORMATION_WRITER_GUIDE,
    assignmentBlock: `## Assignment\n- Topic: ${topic}\n- Destination: ${destination}\n- Primary keyword: ${primaryKeyword}`,
    contextBlocks: [
      intentContract,
      buildBlogContentBriefPromptBlock(brief),
      buildInfoWriterPromptBlock(buildInfoGuideBrief(brief)),
    ],
    depthBlock: buildInformationalDepthBlock('mid'),
    qualityBlock: buildInformationalQualityBlock({ primaryKeyword, destination }),
  });
}

describe('informational writer prompt contract', () => {
  it.each(BLOG_INFORMATION_INTENTS)('assembles a conflict-free prompt for %s', (intent) => {
    const result = buildFixturePrompt(intent);
    expect(auditInformationalWriterPrompt(result.prompt)).toMatchObject({ passed: true, blockers: [] });
    expect(result.manifest.contract).toBe('blog_information_writer_v2');
    expect(result.manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.prompt).toContain('Do not create sales, consultation, package, community, or hashtag sections.');
    expect(result.prompt).not.toContain('5~8회 반복');
    expect(result.prompt).not.toContain('1.5%');
    expect(result.prompt).not.toContain('내부 링크(여소남 상품 페이지) 1개 이상');
  });

  it('produces a stable digest for the same prompt inputs', () => {
    expect(buildFixturePrompt('monthly_weather').manifest.digest)
      .toBe(buildFixturePrompt('monthly_weather').manifest.digest);
  });

  it('fails closed when a legacy sales or SEO quota is reintroduced', () => {
    const prompt = `${buildFixturePrompt('itinerary').prompt}\n- 키워드 5~8회 반복`;
    expect(auditInformationalWriterPrompt(prompt)).toMatchObject({
      passed: false,
      blockers: ['legacy_conflict:keyword_repetition_quota'],
    });
  });
});
