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
import {
  inspectBlogInformationMarkdown,
  type BlogInformationIntent,
} from './blog-information-contract';
import {
  createBlogInformationSourceContentHash,
  normalizeBlogInformationSourceSnapshot,
  validateBlogInformationResearchBundle,
} from './blog-information-evidence';
import { buildBlogInformationPlan, type BlogInformationPlan } from './blog-information-planner';
import { evaluateBlogPublicEligibility } from './blog-public-eligibility';
import { validateBlogInformationStructure } from './blog-information-structure';
import {
  buildBlogInformationalCtaSettings,
  selectBlogInformationalCtas,
  stripBlogInformationalBodyCtas,
} from './blog-informational-cta';
import { rankBlogInformationalRelatedLinks } from './blog-informational-related-links';
import { inspectBlogRenderedSeoQuality } from './blog-rendered-seo-quality';

const EVAL_NOW = new Date('2026-07-15T09:00:00.000Z');

export type BlogInformationEvalCheckStatus = 'PASS' | 'EXPECTED_BLOCK' | 'FAIL';

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
    labelOnlyBlocked: BlogInformationEvalCheck;
    structuredContent: BlogInformationEvalCheck;
    evidenceCoverage: BlogInformationEvalCheck;
    unsupportedNumbersBlocked: BlogInformationEvalCheck;
    claimValidation: BlogInformationEvalCheck;
    relatedLinks: BlogInformationEvalCheck;
    ctaSelection: BlogInformationEvalCheck;
    bodyCtaSanitization: BlogInformationEvalCheck;
    renderQuality: BlogInformationEvalCheck;
    publicEligibility: BlogInformationEvalCheck;
    publishState: BlogInformationEvalCheck;
  };
}

export interface BlogInformationEngineV2EvalReport {
  schemaVersion: 2;
  evaluatedAt: string;
  fixtureOnly: true;
  realPathModules: true;
  externalCalls: 0;
  publicMutations: 0;
  total: number;
  passed: number;
  failed: number;
  ok: boolean;
  cases: BlogInformationEngineV2EvalCaseResult[];
}

function check(
  passed: boolean,
  evidence: unknown,
  expectedBlock = false,
): BlogInformationEvalCheck {
  return {
    status: passed ? (expectedBlock ? 'EXPECTED_BLOCK' : 'PASS') : 'FAIL',
    passed,
    evidence,
  };
}

function requiredSectionScaffold(plan: BlogInformationPlan): string {
  return plan.requiredFacts
    .map((fact) => `## ${fact.label}\n\n아래 구조화 자료와 근거 범위를 기준으로 확인합니다.`)
    .join('\n\n');
}

function labelOnlyMarkdown(fixture: BlogInformationEngineV2EvalFixture, plan: BlogInformationPlan): string {
  return [
    `# ${fixture.plannerInput.topic}`,
    '',
    requiredSectionScaffold(plan),
    '',
    '| 구분 | 값 | 비고 |',
    '| --- | --- | --- |',
    '| 항목 | 값 | 확인 필요 |',
    '| 항목 | 값 | 확인 필요 |',
    '| 항목 | 값 | 확인 필요 |',
  ].join('\n');
}

function weatherRows(destination: string): string {
  const clothing = ['코트', '코트', '재킷', '긴팔', '긴팔', '반팔', '반팔', '반팔', '긴팔', '재킷', '코트', '코트'];
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const high = destination === '몽골' ? -12 + index * 3 : 18 + index;
    const low = high - 7;
    const rain = 20 + index * 4;
    return `| ${month}월 | ${high}℃ | ${low}℃ | ${rain}mm | ${clothing[index]} |`;
  }).join('\n');
}

function intentStructure(fixture: BlogInformationEngineV2EvalFixture): string {
  switch (fixture.expectedIntent) {
    case 'food_budget':
      return [
        '조사일 2026-07-15 기준이며 통화는 JPY입니다.',
        '',
        '| 유형 | 하루 예산 | 기준 |',
        '| --- | --- | --- |',
        '| 절약 | 3,500엔 | 간단한 식사 중심 |',
        '| 일반 | 6,500엔 | 현지 식당 포함 |',
        '| 여유 | 11,000엔 | 특식 포함 |',
        '',
        '| 끼니 | 메뉴 | 가격 |',
        '| --- | --- | --- |',
        '| 아침 | 주먹밥 세트 | 600엔 |',
        '| 점심 | 미소라멘 | 1,200엔 |',
        '| 저녁 | 해산물 덮밥 | 2,400엔 |',
        '| 간식 | 우유 아이스크림 | 450엔 |',
        '',
        '3박 4일 여행 총액은 일반형 기준 26,000엔으로 계산합니다.',
        '근거: https://statistics.gov.example/sapporo-food-2026',
      ].join('\n');
    case 'monthly_weather':
      return [
        '관측 기간은 1991~2020 평년이며 요청 범위는 1월부터 12월입니다.',
        '',
        '| 월 | 최고 기온 | 최저 기온 | 강수 | 옷차림 |',
        '| --- | --- | --- | --- | --- |',
        weatherRows(fixture.plannerInput.destination || '광저우'),
        '',
        '공식 기후 자료: https://weather.gov.example/climate-normal',
      ].join('\n');
    case 'airport_transport':
      return [
        '| 교통 수단 | 요금 | 소요 시간 | 운영 시간 |',
        '| --- | --- | --- | --- |',
        '| 공항철도 | 1,200엔 | 50분 | 첫차 05:30 · 막차 23:00 |',
        '| 리무진버스 | 1,800엔 | 65분 | 첫차 06:00 · 막차 22:30 |',
        '| 택시 | 16,000엔 | 45분 | 24시간 |',
        '',
        '수하물이 많으면 버스나 택시를, 심야·야간 도착이면 운행 종료 여부를 확인합니다.',
        '근거: https://transport.gov.example/osaka-airport',
      ].join('\n');
    case 'local_transport':
      return [
        '| 노선·수단 | 요금 | 소요 시간·배차 | 운행 시간 |',
        '| --- | --- | --- | --- |',
        '| 밴프-레이크 루이스 8X 버스 | CAD 12.50 | 57분 · 30분 간격 | 07:00~22:00 |',
        '| 레이크 루이스 셔틀 | CAD 8 | 45분 · 60분 간격 | 08:00~19:00 |',
        '',
        '승차권과 패스는 공식 운영사에서 구매·예약하며, 성수기와 계절 운행 변경 여부를 출발 전에 확인합니다.',
        '공식 운영사 근거: https://transit.gov.example/banff-routes',
      ].join('\n');
    case 'hotel_areas':
      return [
        '| 지역 | 숙소 1박 가격 | 장점·단점 | 접근 | 추천 대상 |',
        '| --- | --- | --- | --- | --- |',
        '| 타이베이역 | 120,000원 | 교통이 편리하지만 혼잡 | 역 도보 5분 | 첫 여행자 추천 |',
        '| 시먼딩 | 145,000원 | 식당이 가깝지만 밤에 혼잡 | 지하철 도보 7분 | 커플 추천 |',
        '| 중산 | 170,000원 | 조용하지만 공항에서 멀 수 있음 | 역 도보 8분 | 가족 추천 |',
      ].join('\n');
    case 'family_budget':
      return [
        '성인 2명, 아동 1명의 3박 4일 여행이며 조사일 2026-07-15, 통화는 SGD입니다.',
        '',
        '| 예산 항목 | 금액 | 산정 기준 |',
        '| --- | --- | --- |',
        '| 항공 | 1,500SGD | 왕복 3인 |',
        '| 숙소 | 900SGD | 3박 |',
        '| 식비 | 600SGD | 4일 |',
        '| 교통 | 180SGD | 대중교통 중심 |',
        '| 총액 | 3,180SGD | 가족 전체 |',
      ].join('\n');
    case 'shopping_souvenirs':
      return [
        '| 기념품 품목 | 가격 | 구매 지역 |',
        '| --- | --- | --- |',
        '| 건망고 | 4.5USD | 아얄라몰 매장 |',
        '| 드라이 코코넛 | 3.2USD | IT파크 지역 슈퍼마켓 |',
        '| 기타 키링 | 2.1USD | 막탄 공항 매장 |',
        '',
        '반입·면세 주의사항 공식 세관 근거: https://customs.gov.example/cebu-souvenirs',
      ].join('\n');
    case 'currency_payment':
      return [
        '현지 통화는 CNY이며 환율은 2026-07-15 기준으로 다시 확인합니다.',
        '',
        '| 결제 수단 | 수수료 | 현금·카드 사용 조건 |',
        '| --- | --- | --- |',
        '| 현금 | 환전 수수료 1.5% | 소규모 매장 예비 수단 |',
        '| 카드 | 해외 결제 수수료 2.0% | 호텔과 대형 매장 |',
        '| 모바일 결제 | 충전 수수료 0.8% | 본인 인증 가능 시 |',
        '',
        '환율 근거: https://bank.gov.example/cny-rate',
      ].join('\n');
    case 'entry_requirements':
      return [
        '목적 국가는 일본이며 여행자 국적은 대한민국 여권을 가진 한국인입니다.',
        '관광 목적의 체류 기간 30일을 가정하며 여권, 비자와 전자 허가 조건을 각각 확인합니다.',
        '확인일 2026-07-15 기준 공식 1차 출처: https://immigration.gov.example/japan-entry',
      ].join('\n');
    case 'travel_insurance':
      return [
        '| 보장 항목 | 한도 | 자기부담 | 면책·청구 조건 |',
        '| --- | --- | --- | --- |',
        '| 해외 의료 | 한도 50,000,000원 | 100,000원 | 기존 질병 면책, 진단 서류 청구 |',
        '| 상해 후송 | 한도 30,000,000원 | 50,000원 | 승인 절차와 영수증 서류 필요 |',
        '| 수하물 | 한도 1,000,000원 | 30,000원 | 분실 신고 서류 청구 |',
        '',
        '자기부담금은 30,000원부터이며 면책과 보장 제외 사항은 상품별 약관을 확인합니다.',
        '보험사 약관·감독기관 공식 1차 출처: https://insurance.gov.example/travel-policy',
      ].join('\n');
    case 'itinerary':
      return [
        '| 일차 | 장소 | 이동 관계 | 현실적인 시간 | 휴무·예약 조건 |',
        '| --- | --- | --- | --- | --- |',
        '| 1일 차 | 미케비치 | 공항에서 버스 이동 | 09:00~12:00 | 연중 운영, 예약 불필요 |',
        '| 2일 차 | 바나힐 | 셔틀버스 이동 | 08:00~16:00 | 운영 시간과 사전 예약 확인 |',
        '| 3일 차 | 호이안 올드타운 | 버스 이동 | 10:00~18:00 | 입장 마감과 휴무 확인 |',
        '',
        '공식 운영 정보: https://tourism.gov.example/danang-itinerary',
      ].join('\n');
  }
}

function validMarkdown(fixture: BlogInformationEngineV2EvalFixture, plan: BlogInformationPlan): string {
  return [
    `# ${fixture.plannerInput.topic}`,
    '',
    `${plan.primaryQuestion} 아래 기준일과 범위를 먼저 확인한 뒤 표를 비교합니다.`,
    '',
    requiredSectionScaffold(plan),
    '',
    intentStructure(fixture),
  ].join('\n');
}

function persistedClaims(
  markdown: string,
  plan: BlogInformationPlan,
): PersistedBlogInformationClaimRecord[] {
  return extractBlogInformationClaims(markdown).map((claim, index) => ({
    claimFingerprint: claim.claimFingerprint,
    claimText: claim.claimText,
    claimType: claim.claimType,
    extractedValue: claim.extractedValue,
    validationStatus: 'supported',
    evidence: [{
      evidenceKey: `evidence-${index + 1}`,
      sourceVersionId: `source-version-${index + 1}`,
      claimType: claim.claimType,
      observedAt: '2026-07-15T08:00:00.000Z',
      validUntil: '2026-08-15T00:00:00.000Z',
      excerpt: `2026 ${plan.destinationName ?? '해외여행'} ${plan.travelerNationality ?? plan.audience}: ${claim.claimText}`,
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
        conditions: ['R14 deterministic safety fixture'],
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

function expectedScope(plan: BlogInformationPlan) {
  return {
    country: plan.destinationName ?? '대한민국',
    destination: plan.destinationName ?? '해외여행',
    applicableTo: plan.travelerNationality ?? plan.audience,
    locale: plan.locale,
  };
}

async function evaluateFixture(
  fixture: BlogInformationEngineV2EvalFixture,
): Promise<BlogInformationEngineV2EvalCaseResult> {
  const plan = buildBlogInformationPlan(fixture.plannerInput);
  const markdown = validMarkdown(fixture, plan);
  const labelOnly = labelOnlyMarkdown(fixture, plan);
  const content = inspectBlogInformationMarkdown({ markdown, contract: plan.contract });
  const structure = validateBlogInformationStructure({ intent: plan.intent, markdown });
  const labelOnlyReport = inspectBlogInformationMarkdown({ markdown: labelOnly, contract: plan.contract });
  const claims = extractBlogInformationClaims(markdown);
  const savedClaims = persistedClaims(markdown, plan);
  const researchExcerpts = claims.map((claim) => normalizeBlogInformationSourceSnapshot(
    `2026 ${plan.destinationName ?? '해외여행'} ${plan.travelerNationality ?? plan.audience}: ${claim.claimText}`,
  ));
  const researchSnapshot = researchExcerpts.join('\n');
  const research = validateBlogInformationResearchBundle({
    contentKey: fixture.slug,
    sources: [{
      sourceKey: 'r14-official-source',
      sourceType: 'government',
      authorityLevel: 'official_primary',
      sourceUrl: 'https://evidence.gov.example/r14-source',
      publisher: 'R14 Official Fixture Authority',
      retrievedAt: '2026-07-15T08:00:00.000Z',
      snapshotContent: researchSnapshot,
      contentHash: createBlogInformationSourceContentHash(researchSnapshot),
      validUntil: '2026-08-15T00:00:00.000Z',
      destination: plan.destinationName ?? '해외여행',
      country: plan.destinationName ?? '대한민국',
      claimTypes: [...new Set(claims.map((claim) => claim.claimType))],
      riskLevel: plan.riskLevel,
    }],
    evidence: claims.map((claim, index) => ({
      evidenceKey: `evidence-${index + 1}`,
      sourceKey: 'r14-official-source',
      sourceLocator: `r14:${index + 1}`,
      excerpt: researchExcerpts[index],
      spanStart: researchExcerpts.slice(0, index)
        .reduce((length, item) => length + Array.from(item).length + 1, 0),
      spanEnd: researchExcerpts.slice(0, index)
        .reduce((length, item) => length + Array.from(item).length + 1, 0)
        + Array.from(researchExcerpts[index]).length,
      claimType: claim.claimType,
      riskLevel: claim.riskLevel,
      observedAt: '2026-07-15T08:00:00.000Z',
      validUntil: '2026-08-15T00:00:00.000Z',
      scope: {
        ...expectedScope(plan),
        claimType: claim.claimType,
        normalizedValue: claim.extractedValue.normalizedValue,
        unit: claim.extractedValue.unit,
        currency: claim.extractedValue.currency,
        verifiedAt: '2026-07-15T08:00:00.000Z',
        nextReviewAt: '2026-08-15T00:00:00.000Z',
        conditions: ['R14 deterministic safety fixture'],
      },
    })),
    claims: claims.map((claim, index) => ({
      claimFingerprint: claim.claimFingerprint,
      claimText: claim.claimText,
      claimType: claim.claimType,
      riskLevel: claim.riskLevel,
      extractedValue: claim.extractedValue,
      requiresEvidence: true,
      evidenceKeys: [`evidence-${index + 1}`],
    })),
  });

  const pendingClaims = validateBlogInformationClaims({
    markdown,
    persistedClaims: savedClaims,
    intentType: plan.intent,
    expectedScope: expectedScope(plan),
    reviewStatus: plan.requiresHumanReview ? 'pending_review' : 'approved',
    now: EVAL_NOW,
  });
  const approvedClaims = validateBlogInformationClaims({
    markdown,
    persistedClaims: savedClaims,
    intentType: plan.intent,
    expectedScope: expectedScope(plan),
    reviewStatus: 'approved',
    now: EVAL_NOW,
  });
  const noEvidenceClaims = validateBlogInformationClaims({
    markdown,
    persistedClaims: [],
    intentType: plan.intent,
    expectedScope: expectedScope(plan),
    reviewStatus: 'approved',
    now: EVAL_NOW,
  });

  const destinationId = plan.destinationId || 'global';
  const identity = {
    destinationId,
    intent: plan.intent,
    audience: plan.audience,
    locale: plan.locale,
  };
  const relatedIntent = ({
    food_budget: 'currency_payment',
    monthly_weather: 'airport_transport',
    airport_transport: 'hotel_areas',
    local_transport: 'itinerary',
    hotel_areas: 'local_transport',
    family_budget: 'food_budget',
    itinerary: 'monthly_weather',
    shopping_souvenirs: 'currency_payment',
    currency_payment: 'food_budget',
    entry_requirements: 'travel_insurance',
    travel_insurance: 'entry_requirements',
    general: 'food_budget',
  } satisfies Record<BlogInformationIntent, BlogInformationIntent>)[plan.intent];
  const related = rankBlogInformationalRelatedLinks({
    slug: fixture.slug,
    title: fixture.plannerInput.topic || fixture.label,
    destination: plan.destinationName,
    ...identity,
  }, [{
    id: `related-${fixture.id}`,
    slug: `${destinationId}-related-guide`,
    title: `${plan.destinationName || '해외여행'} 관련 정보 가이드`,
    destination: plan.destinationName,
    destinationId,
    intent: relatedIntent,
    audience: plan.audience,
    locale: plan.locale,
    status: 'published',
  }]);
  const ctaSettings = buildBlogInformationalCtaSettings({
    destination: plan.destinationName,
    relatedArticlesHref: `/blog/${destinationId}-related-guide`,
    naverCafeUrl: 'https://cafe.naver.com/yeosonam',
    dealRoomUrl: 'https://open.kakao.com/o/gAbCdEf1',
    consultationUrl: 'https://pf.kakao.com/_AbCdEf/chat',
    officialSourceUrl: 'https://immigration.gov.example/r14-source',
    officialSourceRegistryHostname: 'immigration.gov.example',
  });
  const ctas = selectBlogInformationalCtas({
    intent: plan.intent,
    destination: plan.destinationName,
    riskLevel: plan.riskLevel,
    locale: plan.locale,
    settings: ctaSettings,
  });
  const injectedBodyCtas = `${markdown}\n\n[지금 예약 가능](/packages)\n\n[상담하기](https://pf.kakao.com/_AbCdEf/chat)`;
  const sanitizedMarkdown = stripBlogInformationalBodyCtas(injectedBodyCtas);
  const generationMeta = {
    content_brief: {
      destination_id: destinationId,
      intent_type: plan.intent,
      audience: plan.audience,
      locale: plan.locale,
      risk_level: plan.riskLevel,
      requires_human_review: plan.requiresHumanReview,
    },
    information_claim_validation: { passed: approvedClaims.passed },
    information_representative: {
      status: 'active',
      canonical_slug: fixture.slug,
    },
  };
  const title = fixture.plannerInput.topic || fixture.label;
  const rendered = await inspectBlogRenderedSeoQuality({
    markdown: sanitizedMarkdown,
    slug: fixture.slug,
    title,
    description: `${title}의 실제 기준, 가격, 조건을 근거와 함께 정리합니다.`,
    destination: plan.destinationName,
    generationMeta,
  });

  const expectedPending = fixture.expectedPublishState === 'pending_review';
  const publicEligibility = evaluateBlogPublicEligibility({
    id: fixture.id,
    slug: fixture.slug,
    status: 'published',
    channel: 'naver_blog',
    reviewStatus: expectedPending ? 'pending_review' : 'approved',
    title,
    contentType: 'information',
    generationMeta,
    qualityGate: { passed: true },
    representative: {
      status: 'active',
      canonicalCreativeId: fixture.id,
      canonicalSlug: fixture.slug,
    },
  });

  const corePassed = plan.passed
    && content.passed
    && structure.passed
    && research.passed
    && approvedClaims.passed
    && rendered.passed;
  const actualPublishState: BlogInformationEngineV2EvalCaseResult['actualPublishState'] = !corePassed
    ? 'draft'
    : plan.requiresHumanReview
      ? 'pending_review'
      : 'published';
  const checks = {
    intent: check(plan.passed && plan.intent === fixture.expectedIntent, {
      actual: plan.intent,
      expected: fixture.expectedIntent,
      missingInputs: plan.missingInputs,
    }),
    labelOnlyBlocked: check(!labelOnlyReport.passed, {
      missingSlots: labelOnlyReport.missingSlots,
      structuredIssues: labelOnlyReport.structuredIssues,
    }, true),
    structuredContent: check(content.passed && structure.passed, {
      contractIssues: content.issues,
      structureIssues: structure.issues,
      tableCount: structure.tableCount,
      meaningfulRowCount: structure.meaningfulRowCount,
    }),
    evidenceCoverage: check(research.passed && claims.length > 0 && savedClaims.length === claims.length, {
      claims: claims.length,
      persistedClaims: savedClaims.length,
      issues: research.issues,
    }),
    unsupportedNumbersBlocked: check(claims.length > 0 && !noEvidenceClaims.passed, {
      claims: claims.length,
      issues: noEvidenceClaims.issues.map((issue) => issue.code),
    }, true),
    claimValidation: check(
      approvedClaims.passed
        && (plan.requiresHumanReview
          ? !pendingClaims.passed && pendingClaims.requiresHumanReview
          : pendingClaims.passed),
      {
        approved: approvedClaims.passed,
        pending: pendingClaims.passed,
        requiresHumanReview: pendingClaims.requiresHumanReview,
        issues: pendingClaims.issues.map((issue) => issue.code),
      },
      plan.requiresHumanReview,
    ),
    relatedLinks: check(
      related.length > 0
        && related.every((item) => item.candidate.destinationId === destinationId)
        && related.every((item) => item.candidate.slug !== fixture.slug),
      { slugs: related.map((item) => item.candidate.slug), reasons: related.flatMap((item) => item.reasons) },
    ),
    ctaSelection: check(
      JSON.stringify(ctas.map((cta) => cta.key)) === JSON.stringify(fixture.expectedCtaKeys)
        && ctas.length <= 2,
      { actual: ctas.map((cta) => cta.key), expected: fixture.expectedCtaKeys },
    ),
    bodyCtaSanitization: check(
      !sanitizedMarkdown.includes('](/packages)')
        && !sanitizedMarkdown.includes('](https://pf.kakao.com/')
        && sanitizedMarkdown.includes('지금 예약 가능')
        && sanitizedMarkdown.includes('상담하기'),
      { sanitizedTail: sanitizedMarkdown.slice(-120) },
    ),
    renderQuality: check(rendered.passed, {
      issues: rendered.issues.map((issue) => issue.code),
      canonicalUrl: rendered.canonicalUrl,
    }),
    publicEligibility: check(
      expectedPending
        ? !publicEligibility.eligible && publicEligibility.reason === 'review_blocked'
        : publicEligibility.eligible && publicEligibility.reason === 'eligible_information_v2',
      publicEligibility,
      expectedPending,
    ),
    publishState: check(actualPublishState === fixture.expectedPublishState, {
      actual: actualPublishState,
      expected: fixture.expectedPublishState,
    }, expectedPending),
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
    schemaVersion: 2,
    evaluatedAt: EVAL_NOW.toISOString(),
    fixtureOnly: true,
    realPathModules: true,
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
    '# 정보성 콘텐츠 엔진 V2 — R14 실제 경로 안전성 평가',
    '',
    `- 결과: ${report.ok ? 'PASS' : 'FAIL'} (${report.passed}/${report.total})`,
    '- 경로: intent → planner → 구조 계약 → claim/evidence → 관련 글/CTA → 렌더 → 공개 적격성',
    `- 외부 API 호출: ${report.externalCalls}회`,
    `- 공개/운영 데이터 변경: ${report.publicMutations}건`,
    '',
    '| 샘플 | 라벨만 차단 | 구조 | 근거 없는 수치 | claim | 관련 글/CTA | 렌더 | 공개 적격성 | 발행 상태 | 결과 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.cases.map((item) => [
      item.label,
      item.checks.labelOnlyBlocked.status,
      item.checks.structuredContent.status,
      item.checks.unsupportedNumbersBlocked.status,
      item.checks.claimValidation.status,
      `${item.checks.relatedLinks.status}/${item.checks.ctaSelection.status}`,
      item.checks.renderQuality.status,
      item.checks.publicEligibility.status,
      item.actualPublishState,
      item.passed ? 'PASS' : 'FAIL',
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    '> 실제 운영 모듈을 호출하되, 고정 메모리 fixture만 사용하며 운영 글·원격 DB·외부 API는 변경하거나 호출하지 않습니다.',
    '',
  ];
  return lines.join('\n');
}
