import { buildBlogContentBrief, buildBlogContentBriefPromptBlock } from '../src/lib/blog-content-brief';
import { buildInfoGuideBrief, buildInfoWriterPromptBlock } from '../src/lib/blog-editorial-voice';
import {
  auditInformationalWriterPrompt,
  buildInformationalDepthBlock,
  buildInformationalQualityBlock,
  buildInformationalWriterPrompt,
} from '../src/lib/blog-informational-writer-prompt';
import { BLOG_INFORMATION_INTENTS } from '../src/lib/blog-information-contract';
import { BLOG_INFORMATION_WRITER_GUIDE } from '../src/prompts/blog/informational-writer-guide';

const FIXTURES: Record<(typeof BLOG_INFORMATION_INTENTS)[number], {
  topic: string;
  destination: string;
  primaryKeyword: string;
  category: string;
}> = {
  food_budget: { topic: '삿포로 여행 식비', destination: '삿포로', primaryKeyword: '삿포로 식비', category: 'food' },
  monthly_weather: { topic: '괌 8월 날씨와 옷차림', destination: '괌', primaryKeyword: '괌 8월 날씨', category: 'weather' },
  airport_transport: { topic: '세부 공항에서 시내 이동', destination: '세부', primaryKeyword: '세부 공항 교통', category: 'transport' },
  hotel_areas: { topic: '괌 호텔 지역 비교', destination: '괌', primaryKeyword: '괌 호텔 위치', category: 'hotel' },
  family_budget: { topic: '보홀 가족여행 예산', destination: '보홀', primaryKeyword: '보홀 가족여행 비용', category: 'cost' },
  itinerary: { topic: '다낭 3박 4일 일정', destination: '다낭', primaryKeyword: '다낭 여행 일정', category: 'itinerary' },
  shopping_souvenirs: { topic: '괌 쇼핑 기념품 가이드', destination: '괌', primaryKeyword: '괌 쇼핑', category: 'shopping' },
  currency_payment: { topic: '발리 환전과 카드 결제', destination: '발리', primaryKeyword: '발리 환전', category: 'currency' },
  entry_requirements: { topic: '일본 입국 준비 서류', destination: '일본', primaryKeyword: '일본 입국 서류', category: 'visa' },
  travel_insurance: { topic: '태국 여행자보험 확인사항', destination: '태국', primaryKeyword: '태국 여행자보험', category: 'insurance' },
};

const cases = BLOG_INFORMATION_INTENTS.map((intent) => {
  const fixture = FIXTURES[intent];
  const brief = buildBlogContentBrief({
    ...fixture,
    microAngle: intent,
    travelerNationality: intent === 'entry_requirements' ? 'KR' : null,
  });
  if (!brief.passed || brief.intentType !== intent) {
    return {
      intent,
      passed: false,
      score: 0,
      issues: [`brief:${brief.issues.join(',') || brief.intentType}`],
    };
  }
  const result = buildInformationalWriterPrompt({
    guide: BLOG_INFORMATION_WRITER_GUIDE,
    assignmentBlock: `## Assignment\n- Topic: ${fixture.topic}\n- Destination: ${fixture.destination}\n- Primary keyword: ${fixture.primaryKeyword}`,
    contextBlocks: [
      '## Intent contract\n- Mode: information\n- Reader intent: decide',
      buildBlogContentBriefPromptBlock(brief),
      buildInfoWriterPromptBlock(buildInfoGuideBrief(brief)),
      '## Verified research evidence pack - mandatory factual boundary\n- Synthetic evaluation evidence only; do not add facts.',
    ],
    depthBlock: buildInformationalDepthBlock(intent === 'itinerary' ? 'head' : 'mid'),
    qualityBlock: buildInformationalQualityBlock(fixture),
  });
  const audit = auditInformationalWriterPrompt(result.prompt);
  const assertions = [
    audit.passed,
    result.prompt.includes('## Instruction priority'),
    result.prompt.includes('## Factual safety'),
    result.prompt.includes('## People-first search presentation'),
    result.prompt.includes('## Structured factual claim ledger'),
    result.prompt.includes('The renderer adds verified contextual actions'),
    result.prompt.length <= 30_000,
    /^[a-f0-9]{64}$/.test(result.manifest.digest),
  ];
  const score = Math.round((assertions.filter(Boolean).length / assertions.length) * 100);
  return {
    intent,
    passed: score === 100,
    score,
    promptCharacters: result.manifest.characters,
    estimatedTokens: result.manifest.estimated_tokens,
    digest: result.manifest.digest,
    issues: [...audit.blockers, ...audit.warnings],
  };
});

const passed = cases.filter((testCase) => testCase.passed).length;
const report = {
  suite: 'blog_information_writer_prompt_v2',
  evaluatedAt: new Date().toISOString(),
  score: Math.round(cases.reduce((sum, testCase) => sum + testCase.score, 0) / cases.length),
  passed: passed === cases.length,
  summary: `${passed}/${cases.length} prompt contracts passed`,
  cases,
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
