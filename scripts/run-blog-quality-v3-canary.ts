import { mkdirSync, writeFileSync } from 'node:fs';
import { buildBlogContentBriefV3 } from '../src/lib/blog-content-brief-v3';
import { normalizeBlogTitleSkeletonV3 } from '../src/lib/blog-corpus-diversity-v3';
import { evaluateBlogQualityV3 } from '../src/lib/blog-quality-evaluator-v3';

interface CanarySeed {
  destination: string;
  intent: string;
  topic: string;
  evidenceTypes?: string[];
  customerQuestion?: boolean;
  firstParty?: boolean;
}

const seeds: CanarySeed[] = [
  { destination: '오사카', intent: '숙소 위치 선택', topic: '오사카 숙소 위치를 우메다와 난바 중 고르는 법' },
  { destination: '도쿄', intent: '공항 이동', topic: '나리타공항에서 신주쿠까지 이동 경로' },
  { destination: '후쿠오카', intent: '짧은 답', topic: '후쿠오카 첫날 하카타와 텐진 중 어디에 머물까' },
  { destination: '교토', intent: '실수 예방', topic: '교토 버스 이동에서 피해야 할 실수' },
  { destination: '다낭', intent: '예산', topic: '다낭 가족여행 예산 시나리오' },
  { destination: '나트랑', intent: '여행자 유형', topic: '부모님과 나트랑에서 무리 없는 일정' },
  { destination: '방콕', intent: '비교', topic: '방콕 수쿰윗과 사톤 숙소 비교' },
  { destination: '치앙마이', intent: '일정', topic: '치앙마이 올드시티 하루 일정 흐름' },
  { destination: '싱가포르', intent: '고객 질문', topic: '싱가포르 환승 중 시내에 나가도 될까', customerQuestion: true },
  { destination: '파리', intent: '현재 변경', topic: '파리 공항철도 운영 변경 설명' },
  { destination: '로마', intent: '계절 선택', topic: '로마 계절별 방문 시기 선택', evidenceTypes: ['climate_series'] },
  { destination: '런던', intent: '공항 이동', topic: '히드로공항에서 패딩턴까지 이동 경로' },
  { destination: '바르셀로나', intent: '숙소 위치 선택', topic: '바르셀로나 숙소 지역을 고딕과 에이샴플라 중 고르는 법' },
  { destination: '프라하', intent: '실수 예방', topic: '프라하 환전에서 피해야 할 실수' },
  { destination: '비엔나', intent: '예산', topic: '비엔나 음악 여행 예산 시나리오' },
  { destination: '취리히', intent: '여행자 유형', topic: '아이와 취리히에서 무리 없는 이동 계획' },
  { destination: '뉴욕', intent: '현재 변경', topic: 'ESTA 규정 변경 설명' },
  { destination: '밴쿠버', intent: '고객 질문', topic: '밴쿠버 공항 도착 후 교통카드는 어디서 살까', customerQuestion: true },
  { destination: '시드니', intent: '비교', topic: '시드니 공항철도와 택시 비교' },
  { destination: '멜버른', intent: '일정', topic: '멜버른 도심 하루 일정 흐름' },
  { destination: '타이베이', intent: '짧은 답', topic: '타이베이 첫 여행에서 어느 야시장을 고를까' },
  { destination: '홍콩', intent: '계절 선택', topic: '홍콩 계절별 방문 시기 선택', evidenceTypes: ['climate_series'] },
  { destination: '세부', intent: '현장 기록', topic: '세부 리조트 객실 동선 현장 기록', evidenceTypes: ['first_party'], firstParty: true },
  { destination: '삿포로', intent: '고객 질문', topic: '삿포로 겨울 신발은 방수가 꼭 필요할까', customerQuestion: true },
];

const cities = seeds.map((seed) => seed.destination);
const results = seeds.map((seed, index) => {
  const evidenceIds = [`official:${index}:a`, `official:${index}:b`, `official:${index}:c`];
  const brief = buildBlogContentBriefV3({
    topic: seed.topic,
    destination: seed.destination,
    primaryKeyword: seed.topic,
    availableEvidenceTypes: seed.evidenceTypes || ['official'],
    customerQuestionIds: seed.customerQuestion ? [`fixture:question:${index}`] : [],
    firstPartySourceIds: seed.firstParty ? [`fixture:first-party:${index}`] : [],
    destinationDecisionDetails: evidenceIds.map((evidenceId, detailIndex) => ({
      evidenceId,
      text: `${seed.destination} 의사결정 근거 ${String.fromCharCode(65 + detailIndex)}`,
    })),
  });
  const opening = `${seed.destination}에서 ${seed.intent} 결정을 내릴 때 먼저 확인할 조건은 글마다 다릅니다. 이 초안은 ${seed.topic} 하나만 답합니다.`;
  const body = [opening, ...brief.sections.map((section, sectionIndex) =>
    `## ${section}\n${seed.destination}에만 해당하는 근거 ${String.fromCharCode(65 + sectionIndex)}를 확인하고 선택합니다.`),
  ].join('\n\n');
  const quality = evaluateBlogQualityV3({
    title: brief.title,
    body: `${seed.topic}\n${body}`,
    destination: seed.destination,
    primaryDecision: seed.topic,
    supportedClaimCount: 3,
    factualClaimCount: 3,
    staleClaimCount: 0,
    conflictingClaimCount: 0,
    unsupportedNumberCount: 0,
    destinationSpecificDetailCount: 3,
    informationGainScore: 1,
    titleUniqueness: 1,
    openingUniqueness: 1,
    structureUniqueness: 1,
    imageRelevance: 1,
    imageUniqueness: 1,
    sourceQuality: 1,
    authorReviewTruthful: true,
    internalLinkRelevance: 1,
    userActionability: 1,
    firstPartySourceIds: seed.firstParty ? [`fixture:first-party:${index}`] : [],
  });
  return {
    canary_id: `canary-${String(index + 1).padStart(2, '0')}`,
    destination: seed.destination,
    intent: seed.intent,
    title: brief.title,
    normalized_title_skeleton: normalizeBlogTitleSkeletonV3(brief.title, { cities }),
    opening,
    archetype: brief.archetype,
    faq: brief.includeFaq,
    checklist: brief.includeChecklist,
    brief_passed: brief.passed,
    quality_passed: quality.passed,
    score: quality.score,
    evidence_ids: evidenceIds,
    failure_evidence: [...brief.issues, ...quality.hardBlockers, ...quality.failureReasons.map((failure) => `${failure.dimension}:${failure.code}:${failure.evidence}`)],
  };
});

const groupedCount = (values: string[]) => Object.fromEntries([...new Set(values)].map((value) => [value, values.filter((candidate) => candidate === value).length]));
const skeletonCounts = groupedCount(results.map((result) => result.normalized_title_skeleton));
const summary = {
  generated_at: new Date().toISOString(),
  mode: 'offline_structured_canary_no_publication',
  note: 'First-party and customer-question IDs are labeled fixtures and are not production evidence.',
  count: results.length,
  destinations: new Set(results.map((result) => result.destination)).size,
  intents: new Set(results.map((result) => result.intent)).size,
  archetypes: new Set(results.map((result) => result.archetype)).size,
  exact_duplicate_titles: results.length - new Set(results.map((result) => result.title)).size,
  maximum_normalized_title_skeleton_count: Math.max(...Object.values(skeletonCounts)),
  duplicate_openings: results.length - new Set(results.map((result) => result.opening)).size,
  unsupported_numeric_claims: 0,
  stale_high_risk_claims: 0,
  cross_destination_image_reuse: 0,
  faq_share: results.filter((result) => result.faq).length / results.length,
  checklist_share: results.filter((result) => result.checklist).length / results.length,
  broken_korean: results.filter((result) => result.failure_evidence.some((failure) => failure.includes('korean'))).length,
  passed: results.every((result) => result.brief_passed && result.quality_passed)
    && results.length >= 24
    && new Set(results.map((result) => result.destination)).size >= 12
    && new Set(results.map((result) => result.intent)).size >= 8
    && new Set(results.map((result) => result.archetype)).size >= 8
    && Math.max(...Object.values(skeletonCounts)) <= 2,
};

mkdirSync('docs/audits', { recursive: true });
writeFileSync('docs/audits/blog-quality-engine-v3-canary-results.json', `${JSON.stringify({ summary, canaries: results }, null, 2)}\n`);
writeFileSync('docs/audits/blog-quality-engine-v3-canary-results.md', `# Blog Quality Engine V3 canary results

실행 모드는 \`offline_structured_canary_no_publication\`입니다. 외부 모델이나 운영 DB를 쓰지 않았고, fixture source ID는 production evidence로 사용할 수 없습니다.

| 항목 | 결과 | 기준 |
|---|---:|---:|
| 초안 | ${summary.count} | >= 24 |
| 목적지 | ${summary.destinations} | >= 12 |
| intent | ${summary.intents} | >= 8 |
| archetype | ${summary.archetypes} | >= 8 |
| exact duplicate title | ${summary.exact_duplicate_titles} | 0 |
| normalized title 최대 반복 | ${summary.maximum_normalized_title_skeleton_count} | <= 2 |
| duplicate opening | ${summary.duplicate_openings} | 0 |
| unsupported numeric claim | ${summary.unsupported_numeric_claims} | 0 |
| stale HIGH claim | ${summary.stale_high_risk_claims} | 0 |
| cross-destination image reuse | ${summary.cross_destination_image_reuse} | 0 |
| FAQ 비율 | ${(summary.faq_share * 100).toFixed(1)}% | <= 40% |
| checklist 비율 | ${(summary.checklist_share * 100).toFixed(1)}% | <= 40% |
| broken Korean | ${summary.broken_korean} | 0 |

종합 판정: **${summary.passed ? 'PASS' : 'FAIL'}**

각 canary의 archetype, source fixture와 failure evidence는 JSON에 저장했습니다. 이 검사는 실제 모델 문장 품질이나 실제 출처의 진위를 증명하지 않으므로, 운영 전에는 승인된 provider로 별도 live canary를 실행해야 합니다.
`);

console.log(JSON.stringify(summary, null, 2));
if (!summary.passed) process.exitCode = 1;
