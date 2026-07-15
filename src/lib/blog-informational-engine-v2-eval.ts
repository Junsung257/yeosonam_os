import {
  BLOG_INFORMATION_ENGINE_V2_EVAL_FIXTURES,
  type BlogInformationEngineV2EvalFixture,
  type BlogInformationEvalExpectedState,
} from './blog-informational-engine-v2-eval-fixtures';
import {
  extractBlogInformationClaims,
  validateBlogInformationClaims,
  type PersistedBlogInformationClaimRecord,
} from './blog-information-claim-validator';
import { inspectBlogInformationMarkdown } from './blog-information-contract';
import { validateBlogInformationResearchBundle } from './blog-information-evidence';
import { buildBlogInformationPlan } from './blog-information-planner';
import {
  decideBlogInformationDuplicate,
  type BlogInformationRepresentativeRecord,
} from './blog-information-representative';
import { rankBlogInformationalRelatedLinks } from './blog-informational-related-links';
import {
  buildBlogInformationalCtaSettings,
  selectBlogInformationalCtas,
} from './blog-informational-cta';
import { inspectBlogRenderedSeoQuality } from './blog-rendered-seo-quality';

const EVAL_NOW = new Date('2026-07-15T09:00:00.000Z');

export type BlogInformationEvalCheckStatus = 'PASS' | 'EXPECTED_BLOCK' | 'SKIPPED' | 'FAIL';

export interface BlogInformationEvalCheck {
  status: BlogInformationEvalCheckStatus;
  passed: boolean;
  evidence: unknown;
}

export interface BlogInformationEngineV2EvalCaseResult {
  id: string;
  label: string;
  expectedPublishState: BlogInformationEvalExpectedState;
  actualPublishState: BlogInformationEvalExpectedState | 'draft';
  passed: boolean;
  checks: {
    intent: BlogInformationEvalCheck;
    requiredContent: BlogInformationEvalCheck;
    evidenceCoverage: BlogInformationEvalCheck;
    claimValidation: BlogInformationEvalCheck;
    duplicateBehavior: BlogInformationEvalCheck;
    relatedLinks: BlogInformationEvalCheck;
    ctaSelection: BlogInformationEvalCheck;
    renderQuality: BlogInformationEvalCheck;
    publishState: BlogInformationEvalCheck;
  };
}

export interface BlogInformationEngineV2EvalReport {
  schemaVersion: 1;
  evaluatedAt: string;
  fixtureOnly: true;
  externalCalls: 0;
  publicMutations: 0;
  total: number;
  passed: number;
  failed: number;
  ok: boolean;
  cases: BlogInformationEngineV2EvalCaseResult[];
}

function check(passed: boolean, evidence: unknown, expectedBlock = false): BlogInformationEvalCheck {
  return {
    status: passed ? (expectedBlock ? 'EXPECTED_BLOCK' : 'PASS') : 'FAIL',
    passed,
    evidence,
  };
}

function skipped(evidence: unknown): BlogInformationEvalCheck {
  return { status: 'SKIPPED', passed: true, evidence };
}

function buildFixtureMarkdown(fixture: BlogInformationEngineV2EvalFixture): string {
  const plan = buildBlogInformationPlan(fixture.plannerInput);
  const title = fixture.plannerInput.topic || fixture.plannerInput.primaryKeyword || fixture.label;
  const destination = plan.destinationName || '해외여행';
  const sections = plan.requiredFacts.flatMap((fact) => [
    `## ${fact.label}`,
    '',
    `${destination} ${fact.label}은 출발 조건과 이용 시점에 따라 달라질 수 있어 기준일과 공식 안내를 함께 확인합니다.`,
    '',
  ]);
  return [
    `# ${title}`,
    '',
    `${plan.primaryQuestion} 먼저 목적과 예산, 이동 조건을 나눠 확인하면 선택 기준을 빠르게 정할 수 있습니다.`,
    '',
    ...sections,
    '## 비교표',
    '',
    '| 구분 | 확인 기준 | 비고 |',
    '| --- | --- | --- |',
    '| 기본 | 공식 안내 | 출발 전 재확인 |',
    '| 대안 | 일정 조건 | 변경 가능 |',
    '| 최종 | 기준일 기록 | 링크 확인 |',
    ...(fixture.claimText ? ['', fixture.claimText] : []),
  ].join('\n');
}

function buildPersistedClaims(
  markdown: string,
  plan: ReturnType<typeof buildBlogInformationPlan>,
): PersistedBlogInformationClaimRecord[] {
  return extractBlogInformationClaims(markdown).map((claim, index) => ({
    claimFingerprint: claim.claimFingerprint,
    claimText: claim.claimText,
    claimType: claim.claimType,
    extractedValue: claim.extractedValue,
    validationStatus: 'supported',
    evidence: [{
      evidenceKey: `evidence-${index + 1}`,
      claimType: claim.claimType,
      observedAt: '2026-07-15T08:00:00.000Z',
      validUntil: '2026-08-15T00:00:00.000Z',
      excerpt: `2026년 ${plan.destinationName ?? '대한민국'} ${plan.travelerNationality ?? plan.audience} 대상: ${claim.claimText}`,
      scope: {
        country: plan.destinationName ?? '대한민국',
        destination: plan.destinationName ?? '해외여행',
        applicableTo: plan.travelerNationality ?? plan.audience,
        locale: plan.locale,
        claimType: claim.claimType,
        normalizedValue: claim.extractedValue.normalizedValue,
        unit: claim.extractedValue.unit,
        currency: claim.extractedValue.currency,
        verifiedAt: '2026-07-15T08:00:00.000Z',
        nextReviewAt: '2026-08-15T00:00:00.000Z',
        conditions: ['fixture-only deterministic scope'],
      },
      source: {
        authorityLevel: 'official_primary',
        retrievedAt: '2026-07-15T08:00:00.000Z',
        validUntil: '2026-08-15T00:00:00.000Z',
        status: 'active',
      },
    }],
  }));
}

function derivePublishState(input: {
  planPassed: boolean;
  duplicateAction: string;
  requiresHumanReview: boolean;
  claimPassed: boolean;
  renderPassed: boolean;
}): BlogInformationEngineV2EvalCaseResult['actualPublishState'] {
  if (!input.planPassed) return 'blocked_plan';
  if (input.duplicateAction === 'UPDATE_EXISTING') return 'update_existing';
  if (input.requiresHumanReview || !input.claimPassed) return 'pending_review';
  if (!input.renderPassed) return 'draft';
  return 'published';
}

async function evaluateFixture(
  fixture: BlogInformationEngineV2EvalFixture,
): Promise<BlogInformationEngineV2EvalCaseResult> {
  const plan = buildBlogInformationPlan(fixture.plannerInput);
  const markdown = buildFixtureMarkdown(fixture);
  const invalidPlanExpected = fixture.expectedPublishState === 'blocked_plan';
  const intentCheck = check(
    plan.intent === fixture.expectedIntent && (invalidPlanExpected ? !plan.passed : plan.passed),
    { actual: plan.intent, expected: fixture.expectedIntent, missingInputs: plan.missingInputs },
    invalidPlanExpected,
  );

  if (!plan.passed || !plan.destinationId && plan.intent !== 'travel_insurance') {
    const actualPublishState = 'blocked_plan';
    const publishState = check(actualPublishState === fixture.expectedPublishState, {
      actual: actualPublishState,
      expected: fixture.expectedPublishState,
    }, true);
    const checks = {
      intent: intentCheck,
      requiredContent: skipped('planner_blocked'),
      evidenceCoverage: skipped('planner_blocked'),
      claimValidation: skipped('planner_blocked'),
      duplicateBehavior: skipped('planner_blocked'),
      relatedLinks: skipped('planner_blocked'),
      ctaSelection: skipped('planner_blocked'),
      renderQuality: skipped('planner_blocked'),
      publishState,
    };
    return {
      id: fixture.id,
      label: fixture.label,
      expectedPublishState: fixture.expectedPublishState,
      actualPublishState,
      passed: Object.values(checks).every((item) => item.passed),
      checks,
    };
  }

  const contentReport = inspectBlogInformationMarkdown({ markdown, contract: plan.contract });
  const persistedClaims = buildPersistedClaims(markdown, plan);
  const extractedClaims = extractBlogInformationClaims(markdown);
  const researchValidation = validateBlogInformationResearchBundle({
    contentKey: fixture.slug,
    sources: [{
      sourceKey: 'fixture-source',
      sourceType: plan.riskLevel === 'HIGH' ? 'government' : 'reputable_source',
      authorityLevel: 'official_primary',
      sourceUrl: 'https://example.gov/fixture-source',
      publisher: 'Fixture Authority',
      retrievedAt: '2026-07-15T08:00:00.000Z',
      validUntil: '2026-08-15T00:00:00.000Z',
      destination: plan.destinationName ?? '해외여행',
      country: plan.destinationName ?? '대한민국',
      claimTypes: [...new Set(extractedClaims.map((claim) => claim.claimType))],
      riskLevel: plan.riskLevel,
    }],
    evidence: extractedClaims.map((claim, index) => ({
      evidenceKey: `evidence-${index + 1}`,
      sourceKey: 'fixture-source',
      sourceLocator: `fixture:${index + 1}`,
      excerpt: `2026년 ${plan.destinationName ?? '대한민국'} ${plan.travelerNationality ?? plan.audience} 대상: ${claim.claimText}`,
      claimType: claim.claimType,
      riskLevel: claim.riskLevel,
      observedAt: '2026-07-15T08:00:00.000Z',
      validUntil: '2026-08-15T00:00:00.000Z',
      scope: {
        country: plan.destinationName ?? '대한민국',
        destination: plan.destinationName ?? '해외여행',
        applicableTo: plan.travelerNationality ?? plan.audience,
        locale: plan.locale,
        claimType: claim.claimType,
        normalizedValue: claim.extractedValue.normalizedValue,
        unit: claim.extractedValue.unit,
        currency: claim.extractedValue.currency,
        verifiedAt: '2026-07-15T08:00:00.000Z',
        nextReviewAt: '2026-08-15T00:00:00.000Z',
        conditions: ['fixture-only deterministic scope'],
      },
    })),
    claims: extractedClaims.map((claim, index) => ({
      claimFingerprint: claim.claimFingerprint,
      claimText: claim.claimText,
      claimType: claim.claimType,
      riskLevel: claim.riskLevel,
      extractedValue: claim.extractedValue,
      requiresEvidence: true,
      evidenceKeys: [`evidence-${index + 1}`],
    })),
  });
  const linkedCoverage = extractedClaims.length === 0
    ? 1
    : persistedClaims.filter((claim) => claim.evidence.length > 0).length / extractedClaims.length;
  const claimReport = validateBlogInformationClaims({
    markdown,
    persistedClaims,
    intentType: plan.intent,
    expectedScope: {
      country: plan.destinationName ?? '대한민국',
      destination: plan.destinationName ?? '해외여행',
      applicableTo: plan.travelerNationality ?? plan.audience,
      locale: plan.locale,
    },
    reviewStatus: plan.requiresHumanReview ? 'pending_review' : 'approved',
    now: EVAL_NOW,
  });

  const identity = {
    destinationId: plan.destinationId || 'global',
    intent: plan.intent,
    audience: plan.audience,
    locale: plan.locale,
  };
  const existing: BlogInformationRepresentativeRecord | null = fixture.duplicateMode === 'existing_active'
    ? {
        ...identity,
        representativeKey: `v1|${identity.destinationId}|${identity.intent}|${identity.audience}|${identity.locale}`,
        canonicalCreativeId: 'existing-creative',
        canonicalSlug: 'sapporo-food-budget-canonical',
        status: 'active',
        reservationOwner: 'existing-owner',
      }
    : null;
  const duplicate = decideBlogInformationDuplicate({
    candidate: { ...identity, slug: fixture.slug, title: fixture.label, markdown },
    existing,
    reservationOwner: `fixture:${fixture.id}`,
    existingTitle: existing ? '기존 삿포로 식비 가이드' : null,
    existingMarkdown: existing ? markdown : null,
  });

  const related = rankBlogInformationalRelatedLinks({
    slug: fixture.slug,
    title: fixture.label,
    destination: plan.destinationName,
    ...identity,
  }, [{
    id: 'related-fixture',
    slug: `${plan.destinationId || 'global'}-related-guide`,
    title: `${plan.destinationName || '여행'} 관련 가이드`,
    destination: plan.destinationName,
    destinationId: identity.destinationId,
    intent: plan.intent === 'general' ? 'food_budget' : 'general',
    audience: plan.audience,
    locale: plan.locale,
    status: 'published',
  }]);

  const settings = buildBlogInformationalCtaSettings({
    destination: plan.destinationName,
    relatedArticlesHref: `/blog/${plan.destinationId || 'travel'}-related-guide`,
    naverCafeUrl: fixture.ctaMode === 'configured' ? 'https://cafe.naver.com/yeosonam-fixture' : null,
    dealRoomUrl: fixture.ctaMode === 'configured' ? 'https://example.com/deal-room-fixture' : null,
    consultationUrl: fixture.ctaMode === 'configured' ? 'https://example.com/consult-fixture' : null,
  });
  const ctas = selectBlogInformationalCtas({
    intent: plan.intent,
    destination: plan.destinationName,
    riskLevel: plan.riskLevel,
    locale: plan.locale,
    settings,
  });
  const generationMeta = {
    content_brief: {
      destination_id: identity.destinationId,
      intent_type: identity.intent,
      audience: identity.audience,
      locale: identity.locale,
      risk_level: plan.riskLevel,
    },
  };
  const rendered = await inspectBlogRenderedSeoQuality({
    markdown,
    slug: fixture.slug,
    title: fixture.plannerInput.topic || fixture.label,
    description: `${fixture.plannerInput.topic || fixture.label}에 필요한 기준과 확인 방법을 정리합니다.`,
    destination: plan.destinationName,
    generationMeta,
  });

  const actualPublishState = derivePublishState({
    planPassed: plan.passed,
    duplicateAction: duplicate.action,
    requiresHumanReview: plan.requiresHumanReview,
    claimPassed: claimReport.passed,
    renderPassed: rendered.passed,
  });
  const expectedDuplicateAction = fixture.duplicateMode === 'existing_active' ? 'UPDATE_EXISTING' : 'RESERVE_CREATE';
  const highRiskExpectedBlock = plan.requiresHumanReview;
  const checks = {
    intent: intentCheck,
    requiredContent: check(contentReport.passed, {
      covered: contentReport.coveredSlots,
      missing: contentReport.missingSlots,
    }),
    evidenceCoverage: check(researchValidation.passed && linkedCoverage === 1, {
      linkedCoverage,
      researchIssues: researchValidation.issues,
    }),
    claimValidation: check(
      highRiskExpectedBlock ? !claimReport.passed && claimReport.requiresHumanReview : claimReport.passed,
      {
        passed: claimReport.passed,
        coverage: claimReport.coverage,
        issues: claimReport.issues.map((issue) => issue.code),
      },
      highRiskExpectedBlock,
    ),
    duplicateBehavior: check(duplicate.action === expectedDuplicateAction, {
      actual: duplicate.action,
      expected: expectedDuplicateAction,
      canonicalSlug: duplicate.canonicalSlug,
    }, fixture.duplicateMode === 'existing_active'),
    relatedLinks: check(related.length > 0 && related.every((item) => item.candidate.destinationId === identity.destinationId), {
      slugs: related.map((item) => item.candidate.slug),
      reasons: related.flatMap((item) => item.reasons),
    }),
    ctaSelection: check(
      JSON.stringify(ctas.map((cta) => cta.key)) === JSON.stringify(fixture.expectedCtaKeys),
      { actual: ctas.map((cta) => cta.key), expected: fixture.expectedCtaKeys },
    ),
    renderQuality: check(rendered.passed, {
      readingTimeMinutes: rendered.readingTimeMinutes,
      issues: rendered.issues.map((issue) => issue.code),
    }),
    publishState: check(actualPublishState === fixture.expectedPublishState, {
      actual: actualPublishState,
      expected: fixture.expectedPublishState,
    }, highRiskExpectedBlock || fixture.duplicateMode === 'existing_active'),
  };

  return {
    id: fixture.id,
    label: fixture.label,
    expectedPublishState: fixture.expectedPublishState,
    actualPublishState,
    passed: Object.values(checks).every((item) => item.passed),
    checks,
  };
}

export async function evaluateBlogInformationEngineV2Fixtures(
  fixtures = BLOG_INFORMATION_ENGINE_V2_EVAL_FIXTURES,
): Promise<BlogInformationEngineV2EvalReport> {
  const cases = await Promise.all(fixtures.map(evaluateFixture));
  const passed = cases.filter((item) => item.passed).length;
  return {
    schemaVersion: 1,
    evaluatedAt: EVAL_NOW.toISOString(),
    fixtureOnly: true,
    externalCalls: 0,
    publicMutations: 0,
    total: cases.length,
    passed,
    failed: cases.length - passed,
    ok: passed === cases.length,
    cases,
  };
}

export function formatBlogInformationEngineV2EvalSummary(
  report: BlogInformationEngineV2EvalReport,
): string {
  const lines = [
    '# 정보성 콘텐츠 엔진 V2 — M10 평가 요약',
    '',
    `- 결과: ${report.ok ? 'PASS' : 'FAIL'} (${report.passed}/${report.total})`,
    '- 실행 범위: 고정 fixture/draft 전용',
    `- 외부 API 호출: ${report.externalCalls}회`,
    `- 공개/운영 데이터 변경: ${report.publicMutations}건`,
    '',
    '| 샘플 | 의도 | 필수 내용 | 근거/claim | 중복 | 관련 글 | CTA | 렌더 | 발행 상태 | 결과 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.cases.map((item) => [
      item.label,
      item.checks.intent.status,
      item.checks.requiredContent.status,
      `${item.checks.evidenceCoverage.status}/${item.checks.claimValidation.status}`,
      item.checks.duplicateBehavior.status,
      item.checks.relatedLinks.status,
      item.checks.ctaSelection.status,
      item.checks.renderQuality.status,
      item.actualPublishState,
      item.passed ? 'PASS' : 'FAIL',
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    '> 이 보고서는 운영 글을 생성·수정·발행하지 않습니다. 모든 샘플은 메모리 내 fixture로만 평가했습니다.',
    '',
  ];
  return lines.join('\n');
}
