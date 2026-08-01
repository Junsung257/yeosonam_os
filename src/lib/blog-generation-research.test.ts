import { describe, expect, it } from 'vitest';
import {
  buildBlogInformationContract,
  inspectBlogInformationMarkdown,
  type BlogInformationSourcePolicy,
} from './blog-information-contract';
import {
  createBlogInformationClaimFingerprint,
  createBlogInformationSourceContentHash,
  type BlogInformationResearchBundle,
} from './blog-information-evidence';
import {
  BLOG_INFORMATION_RESEARCH_META_KEY,
  buildBlogGenerationResearchPromptBlock,
  evaluateBlogGenerationResearchReadiness,
  repairBlogGenerationResearchStructure,
  repairMonthlyWeatherEditorialVariation,
  summarizeBlogGenerationResearch,
  type BlogGenerationResearchReadiness,
} from './blog-generation-research';
import { validateBlogInformationStructure } from './blog-information-structure';
import {
  checkArticleQualityV2,
  checkHook,
  checkLinks,
  checkMarkdownTableIntegrity,
} from './blog-quality-gate';
import { inspectBlogImageQuality } from './blog-image-quality';
import { inspectBlogCustomerQuality } from './blog-customer-quality';
import { computeReadability } from './blog-readability';
import { computeSeoScore } from './blog-seo-scorer';
import { inspectRenderedBlogIntegrity, renderBlogContentToHtml } from './blog-renderer';
import { extractFaqItems } from './blog-jsonld';
import { repairBlogFinalCustomerSurface } from './blog-final-customer-surface';
import { extractBlogInformationClaims } from './blog-information-claim-validator';

const CONTENT_KEY = 'sapporo-food-budget';
const CHECKED_AT = '2026-07-19T00:00:00.000Z';

const FOOD_POLICY: BlogInformationSourcePolicy = {
  minimumClaimSourceCoverage: 0.9,
  primarySourcesRequired: false,
  exactNumbersRequireSource: true,
  retrievedAtRequired: true,
  sourceTypes: ['official', 'field_research', 'reputable_local_source', 'reputable_price_source'],
};

function foodBudgetBundle(priceCount = 7): BlogInformationResearchBundle {
  const values = ['3000', '5000', '8000', '700', '1200', '2000', '600'].slice(0, priceCount);
  const labels = ['절약형 하루 예산', '일반형 하루 예산', '여유형 하루 예산', '아침', '점심', '저녁', '간식'];
  const excerpts = values.map((value, index) =>
    `2026년 일본 삿포로 일반 여행자의 ${labels[index]} 기준값은 ${value} JPY입니다.`);
  const snapshotContent = ['삿포로 식비 현장 조사', ...excerpts].join('\n');

  return {
    contentKey: CONTENT_KEY,
    sources: [{
      sourceKey: 'sapporo-food-field-research',
      sourceType: 'field_research',
      authorityLevel: 'field_observation',
      internalIdentifier: 'field-research:sapporo-food:2026-07',
      publisher: '여소남 현장 가격 조사',
      retrievedAt: CHECKED_AT,
      snapshotContent,
      contentHash: createBlogInformationSourceContentHash(snapshotContent),
      validUntil: '2026-08-19T00:00:00.000Z',
      destination: '삿포로',
      country: '일본',
      claimTypes: ['price'],
      riskLevel: 'MEDIUM',
    }],
    evidence: excerpts.map((excerpt, index) => ({
      evidenceKey: `sapporo-food-price-${index + 1}`,
      sourceKey: 'sapporo-food-field-research',
      sourceLocator: `price-row-${index + 1}`,
      excerpt,
      spanStart: Array.from(snapshotContent.slice(0, snapshotContent.indexOf(excerpt))).length,
      spanEnd: Array.from(snapshotContent.slice(0, snapshotContent.indexOf(excerpt))).length
        + Array.from(excerpt).length,
      claimType: 'price',
      riskLevel: 'MEDIUM',
      observedAt: CHECKED_AT,
      validUntil: '2026-08-19T00:00:00.000Z',
      scope: {
        country: '일본',
        destination: '삿포로',
        applicableTo: '일반 여행자',
        locale: 'ko-KR',
        claimType: 'price',
        normalizedValue: values[index],
        unit: null,
        currency: 'JPY',
        verifiedAt: CHECKED_AT,
        nextReviewAt: '2026-08-19T00:00:00.000Z',
        conditions: [`${labels[index]} 기준`],
      },
    })),
    claims: values.map((value, index) => {
      const claimText = `삿포로 일반 여행자의 ${labels[index]} 기준값은 ${value} JPY입니다.`;
      return {
        claimFingerprint: createBlogInformationClaimFingerprint(claimText),
        claimText,
        claimType: 'price' as const,
        riskLevel: 'MEDIUM' as const,
        extractedValue: { normalizedValue: value, unit: null, currency: 'JPY' },
        requiresEvidence: true,
        evidenceKeys: [`sapporo-food-price-${index + 1}`],
      };
    }),
  };
}

const WEATHER_CONTENT_KEY = 'guam-weather-packing';
const WEATHER_POLICY: BlogInformationSourcePolicy = {
  minimumClaimSourceCoverage: 0.9,
  primarySourcesRequired: true,
  exactNumbersRequireSource: true,
  retrievedAtRequired: true,
  sourceTypes: ['official_climate_data'],
};

function monthlyWeatherBundle(monthCount = 12): BlogInformationResearchBundle {
  const statements = Array.from({ length: monthCount }, (_, index) => {
    const month = index + 1;
    return `1981~2010 평년값: ${month}월 최고기온 ${(29 + index / 10).toFixed(1)}°C, 최저기온 ${(24 + index / 10).toFixed(1)}°C, 강수량 ${(100 + index * 20).toFixed(1)}mm, 강수일수 ${(18 + index / 10).toFixed(1)}일`;
  });
  const excerpts = statements.map((statement, index) =>
    `${statement} [검증 범위: 미국 괌; 대상: 괌 여행자; 기준일: 2026-07-24; 값: ${(29 + index / 10).toFixed(1)} °C]`);
  const snapshotContent = excerpts.join('\n\n');
  return {
    contentKey: WEATHER_CONTENT_KEY,
    sources: [{
      sourceKey: 'wmo-guam-climate',
      sourceType: 'meteorological_agency',
      authorityLevel: 'official_primary',
      sourceUrl: 'https://worldweather.wmo.int/kr/json/1954_kr.xml',
      publisher: '미국기상청',
      retrievedAt: '2026-07-24T00:00:00.000Z',
      snapshotContent,
      contentHash: createBlogInformationSourceContentHash(snapshotContent),
      destination: '괌',
      country: '미국',
      claimTypes: ['climate'],
      riskLevel: 'LOW',
    }],
    evidence: excerpts.map((excerpt, index) => {
      const codeUnitStart = snapshotContent.indexOf(excerpt);
      const spanStart = Array.from(snapshotContent.slice(0, codeUnitStart)).length;
      return {
        evidenceKey: `wmo-month-${index + 1}`,
        sourceKey: 'wmo-guam-climate',
        sourceLocator: `month-${index + 1}`,
        excerpt,
        spanStart,
        spanEnd: spanStart + Array.from(excerpt).length,
        claimType: 'climate',
        riskLevel: 'LOW',
        observedAt: '2026-07-24T00:00:00.000Z',
        scope: {
          country: '미국',
          destination: '괌',
          applicableTo: '괌 여행자',
          locale: 'ko-KR',
          claimType: 'climate',
          normalizedValue: (29 + index / 10).toFixed(1),
          unit: '°C',
          currency: null,
          verifiedAt: '2026-07-24T00:00:00.000Z',
          nextReviewAt: '2027-01-20T00:00:00.000Z',
          conditions: [`${index + 1}월`, '1981~2010 평년값'],
        },
      };
    }),
    claims: statements.map((claimText, index) => ({
      claimFingerprint: createBlogInformationClaimFingerprint(claimText),
      claimText,
      claimType: 'climate',
      riskLevel: 'LOW',
      extractedValue: {
        normalizedValue: (29 + index / 10).toFixed(1),
        unit: '°C',
        currency: null,
      },
      requiresEvidence: true,
      evidenceKeys: [`wmo-month-${index + 1}`],
    })),
  };
}

function monthlyWeatherReadiness(bundle: BlogInformationResearchBundle) {
  return evaluateBlogGenerationResearchReadiness({
    meta: { [BLOG_INFORMATION_RESEARCH_META_KEY]: bundle },
    expectedContentKey: WEATHER_CONTENT_KEY,
    destination: '괌',
    intent: 'monthly_weather',
    locale: 'ko-KR',
    sourcePolicy: WEATHER_POLICY,
    now: new Date('2026-07-24T12:00:00.000Z'),
  });
}

function readiness(bundle: BlogInformationResearchBundle | null) {
  return evaluateBlogGenerationResearchReadiness({
    meta: bundle ? { [BLOG_INFORMATION_RESEARCH_META_KEY]: bundle } : {},
    expectedContentKey: CONTENT_KEY,
    destination: '삿포로',
    intent: 'food_budget',
    locale: 'ko-KR',
    sourcePolicy: FOOD_POLICY,
    now: new Date('2026-07-19T12:00:00.000Z'),
  });
}

function entryRequirementsReadiness(destination: string): BlogGenerationResearchReadiness {
  const purposeClaimText = `${destination} 비자면제 입국은 관광 또는 상용 목적의 단기 방문에 적용됩니다.`;
  const stayClaimText = `${destination} 비자면제 입국의 체류 기간은 최대 90일입니다.`;
  const supportingClaimText = `${destination} 비자면제 여행자는 귀국편, 숙소, 재정증빙을 준비해야 합니다.`;
  const customsClaimText = `${destination} 입국 시 식품·농산물과 신고 대상 현금은 세관에 신고해야 합니다.`;
  const claimRecords = [
    { key: 'purpose', text: purposeClaimText, type: 'entry_visa' as const, value: '관광 또는 상용 목적', unit: null },
    { key: 'stay', text: stayClaimText, type: 'entry_visa' as const, value: '90일', unit: '일' },
    { key: 'supporting', text: supportingClaimText, type: 'policy' as const, value: '귀국편·숙소·재정증빙', unit: null },
    { key: 'customs', text: customsClaimText, type: 'policy' as const, value: '세관 신고 대상', unit: null },
  ];
  const snapshotContent = claimRecords.map((record) => record.text).join('\n');
  let spanStart = 0;
  const evidence = claimRecords.map((record) => {
    const evidenceKey = `${destination}-entry-${record.key}`;
    const spanEnd = spanStart + Array.from(record.text).length;
    const item = {
      evidenceKey,
      sourceKey: `${destination}-immigration`,
      excerpt: record.text,
      spanStart,
      spanEnd,
      claimType: record.type,
      riskLevel: 'HIGH' as const,
      observedAt: CHECKED_AT,
      scope: {
        country: destination,
        destination,
        applicableTo: '대한민국 여권 여행자',
        locale: 'ko-KR',
        claimType: record.type,
        normalizedValue: record.value,
        unit: record.unit,
        currency: null,
        verifiedAt: CHECKED_AT,
        nextReviewAt: '2026-08-18T00:00:00.000Z',
        conditions: ['비자면제 입국 기준'],
      },
    };
    spanStart = spanEnd + 1;
    return item;
  });
  return {
    passed: true,
    issues: [],
    bundle: {
      contentKey: `${destination}-entry`,
      sources: [{
        sourceKey: `${destination}-immigration`,
        sourceType: 'immigration',
        authorityLevel: 'official_primary',
        sourceUrl: 'https://travel.state.gov/content/travel/en/us-visas/tourism-visit.html',
        publisher: 'Official immigration authority',
        retrievedAt: CHECKED_AT,
        snapshotContent,
        contentHash: createBlogInformationSourceContentHash(snapshotContent),
        destination,
        country: destination,
        claimTypes: ['entry_visa', 'policy'],
        riskLevel: 'LOW',
      }],
      evidence,
      claims: claimRecords.map((record) => ({
        claimFingerprint: createBlogInformationClaimFingerprint(record.text),
        claimText: record.text,
        claimType: record.type,
        riskLevel: 'HIGH' as const,
        extractedValue: {
          normalizedValue: record.value,
          unit: record.unit,
          currency: null,
        },
        requiresEvidence: true,
        evidenceKeys: [`${destination}-entry-${record.key}`],
      })),
    },
    summary: {
      sourceCount: 1,
      evidenceCount: 4,
      claimCount: 4,
      supportedClaimCount: 4,
      claimSourceCoverage: 1,
      distinctNormalizedValueCount: 4,
    },
  };
}

function localTransportBundle(): BlogInformationResearchBundle {
  type ClaimType = BlogInformationResearchBundle['claims'][number]['claimType'];
  const records: Array<{
    sourceKey: 'parks-canada' | 'roam-transit';
    claimText: string;
    claimType: ClaimType;
    normalizedValue: string;
    unit: string | null;
    currency: string | null;
  }> = [
    {
      sourceKey: 'parks-canada',
      claimText: 'Parks Canada 셔틀의 성인 요금은 12.75 CAD입니다.',
      claimType: 'price',
      normalizedValue: '12.75',
      unit: 'CAD',
      currency: 'CAD',
    },
    {
      sourceKey: 'roam-transit',
      claimText: '밴프와 레이크 루이스 간 Roam Transit 8X 서비스는 성인 12.50 CAD입니다.',
      claimType: 'price',
      normalizedValue: '12.50',
      unit: 'CAD',
      currency: 'CAD',
    },
    {
      sourceKey: 'roam-transit',
      claimText: '밴프 고등학교 교통 허브에서 레이크 루이스 레이크쇼어까지 Roam Transit 8X 서비스는 약 57분 소요됩니다.',
      claimType: 'duration',
      normalizedValue: '57',
      unit: '분',
      currency: null,
    },
    {
      sourceKey: 'roam-transit',
      claimText: 'Roam Transit 8X 서비스는 예약 없이 이용할 경우 여름철 최대 2시간까지 대기할 수 있습니다.',
      claimType: 'duration',
      normalizedValue: '2',
      unit: '시간',
      currency: null,
    },
    {
      sourceKey: 'roam-transit',
      claimText: '밴프와 레이크 루이스 간 Roam Transit 8X 서비스는 연중 매일 직행 연결을 제공합니다.',
      claimType: 'factual',
      normalizedValue: '밴프와 레이크 루이스 간 직행 연결',
      unit: null,
      currency: null,
    },
    {
      sourceKey: 'roam-transit',
      claimText: 'Roam Transit 서비스 중 밴프와 레이크 루이스 간 8X 서비스만 예약이 가능합니다.',
      claimType: 'policy',
      normalizedValue: '8X 서비스만 예약 가능',
      unit: null,
      currency: null,
    },
    {
      sourceKey: 'parks-canada',
      claimText: '모레인 호수 도로는 연중 개인 차량 통행이 금지됩니다.',
      claimType: 'policy',
      normalizedValue: '개인 차량 통행 금지',
      unit: null,
      currency: null,
    },
  ];
  const excerptFor = (record: typeof records[number]) => [
    record.claimText,
    `[검증 범위: Canada 캐나다 로키산맥; 대상: 캐나다 로키산맥 여행자; 기준일: 2026-07-28; 값: ${record.normalizedValue}${record.unit ? ` ${record.unit}` : ''}]`,
  ].join(' ');
  const snapshots = {
    'parks-canada': records.filter((record) => record.sourceKey === 'parks-canada')
      .map(excerptFor).join('\n'),
    'roam-transit': records.filter((record) => record.sourceKey === 'roam-transit')
      .map(excerptFor).join('\n'),
  };
  const sources: BlogInformationResearchBundle['sources'] = [
    {
      sourceKey: 'parks-canada',
      sourceType: 'government',
      authorityLevel: 'official_primary',
      sourceUrl: 'https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise',
      publisher: 'Parks Canada',
      retrievedAt: '2026-07-28T22:26:21.656Z',
      snapshotContent: snapshots['parks-canada'],
      contentHash: createBlogInformationSourceContentHash(snapshots['parks-canada']),
      destination: '캐나다 로키산맥',
      country: 'Canada',
      claimTypes: ['price', 'policy'],
      riskLevel: 'LOW',
    },
    {
      sourceKey: 'roam-transit',
      sourceType: 'transport_operator',
      authorityLevel: 'official_primary',
      sourceUrl: 'https://roamtransit.com/schedules-routes/lake-louise-banff-express-route-8x/',
      publisher: 'Roam Transit',
      retrievedAt: '2026-07-28T22:26:21.656Z',
      snapshotContent: snapshots['roam-transit'],
      contentHash: createBlogInformationSourceContentHash(snapshots['roam-transit']),
      destination: '캐나다 로키산맥',
      country: 'Canada',
      claimTypes: ['price', 'duration', 'factual', 'policy'],
      riskLevel: 'LOW',
    },
  ];

  return {
    contentKey: 'canada-rockies-7-transport',
    sources,
    evidence: records.map((record, index) => {
      const snapshot = snapshots[record.sourceKey];
      const excerpt = excerptFor(record);
      const codeUnitStart = snapshot.indexOf(excerpt);
      const spanStart = Array.from(snapshot.slice(0, codeUnitStart)).length;
      return {
        evidenceKey: `local-transport-${index + 1}`,
        sourceKey: record.sourceKey,
        sourceLocator: `claim-${index + 1}`,
        excerpt,
        spanStart,
        spanEnd: spanStart + Array.from(excerpt).length,
        claimType: record.claimType,
        riskLevel: 'LOW' as const,
        observedAt: '2026-07-28T22:26:21.656Z',
        scope: {
          country: 'Canada',
          destination: '캐나다 로키산맥',
          applicableTo: '캐나다 로키산맥 여행자',
          locale: 'ko-KR',
          claimType: record.claimType,
          normalizedValue: record.normalizedValue,
          unit: record.unit,
          currency: record.currency,
          verifiedAt: '2026-07-28T22:26:21.656Z',
          nextReviewAt: '2026-08-27T22:26:21.656Z',
          conditions: ['공식 운영사 확인일 기준'],
        },
      };
    }),
    claims: records.map((record, index) => ({
      claimFingerprint: createBlogInformationClaimFingerprint(record.claimText),
      claimText: record.claimText,
      claimType: record.claimType,
      riskLevel: 'LOW',
      extractedValue: {
        normalizedValue: record.normalizedValue,
        unit: record.unit,
        currency: record.currency,
      },
      requiresEvidence: true,
      evidenceKeys: [`local-transport-${index + 1}`],
    })),
  };
}

function localTransportReadiness() {
  const contract = buildBlogInformationContract({
    intentType: 'local_transport',
    destination: '캐나다 로키산맥',
    topic: '캐나다 로키산맥 렌터카 없이 대중교통 여행',
    primaryKeyword: '캐나다 로키산맥 대중교통',
    category: 'transport',
    microAngle: 'local_mobility',
  });
  return evaluateBlogGenerationResearchReadiness({
    meta: { [BLOG_INFORMATION_RESEARCH_META_KEY]: localTransportBundle() },
    expectedContentKey: 'canada-rockies-7-transport',
    destination: '캐나다 로키산맥',
    intent: 'local_transport',
    locale: 'ko-KR',
    sourcePolicy: contract.sourcePolicy,
    now: new Date('2026-07-29T00:00:00.000Z'),
  });
}

describe('blog generation research preflight', () => {
  it('adds verified destination and purpose-stay context for entry requirements and stays idempotent', () => {
    const initial = [
      '# 미국 입국 요건과 비자',
      '',
      '여행자 국적은 대한민국 여권을 가진 한국인입니다.',
      '여권과 ESTA 조건을 확인합니다.',
      '확인일 2026-07-30 공식 1차 출처: https://www.cbp.gov/travel/international-visitors/esta',
    ].join('\n');
    const researchReadiness = entryRequirementsReadiness('미국');

    const first = repairBlogGenerationResearchStructure({
      markdown: initial,
      intent: 'entry_requirements',
      readiness: researchReadiness,
    });
    const second = repairBlogGenerationResearchStructure({
      markdown: first.markdown,
      intent: 'entry_requirements',
      readiness: researchReadiness,
    });

    expect(first.changed).toBe(true);
    expect(first.changes).toContain('entry_requirements_verified_destination_context');
    expect(first.changes).toContain('entry_requirements_verified_purpose_stay_context');
    expect(first.changes).toContain('entry_requirements_verified_supporting_documents_context');
    expect(first.changes).toContain('entry_requirements_verified_customs_context');
    expect(first.changes).toContain('entry_requirements_exact_official_items_context');
    expect(first.markdown).toContain('목적 국가: 미국.');
    expect(first.markdown).toContain('여행 목적과 체류기간 (공식 근거):');
    expect(first.markdown).toContain('관광 또는 상용 목적');
    expect(first.markdown).toContain('체류 기간은 최대 90일');
    expect(first.markdown).toContain('귀국편·숙소·재정증빙 확인 (공식 근거):');
    expect(first.markdown).toContain('세관·면세 범위 확인 (공식 근거):');
    expect(first.markdown).toContain('[공식 확인 링크 1](');
    expect(first.approvedClaims).toHaveLength(4);
    expect(validateBlogInformationStructure({
      intent: 'entry_requirements',
      markdown: first.markdown,
    }).issues).not.toContain('entry_requirements:destination_country_required');
    const contract = buildBlogInformationContract({
      intentType: 'entry_requirements',
      destination: '미국',
    });
    const informationReport = inspectBlogInformationMarkdown({
      markdown: first.markdown,
      contract,
    });
    expect(informationReport.missingSlots).not.toContain('purpose_stay');
    expect(informationReport.missingSlots).not.toContain('supporting_documents');
    expect(informationReport.missingSlots).not.toContain('customs_allowance');
    expect(informationReport.missingSlots).not.toContain('exact_official_item');
    expect(second.changed).toBe(false);
    expect(second.markdown).toBe(first.markdown);
  });

  it('does not add an entry destination when passed research contains conflicting destinations', () => {
    const researchReadiness = entryRequirementsReadiness('미국');
    researchReadiness.bundle!.sources.push({
      ...researchReadiness.bundle!.sources[0]!,
      sourceKey: 'japan-immigration',
      destination: '일본',
      country: '일본',
    });
    const markdown = '# 입국 요건\n\n한국인 관광 목적 30일 체류 기준으로 여권과 비자를 확인합니다.';

    const result = repairBlogGenerationResearchStructure({
      markdown,
      intent: 'entry_requirements',
      readiness: researchReadiness,
    });

    expect(result.changed).toBe(false);
    expect(result.markdown).toBe(markdown);
  });

  it('requires the complete entry decision contract before entry writing', () => {
    const complete = entryRequirementsReadiness('미국').bundle!;
    const contract = buildBlogInformationContract({
      intentType: 'entry_requirements',
      destination: '미국',
    });
    const evaluate = (bundle: BlogInformationResearchBundle) =>
      evaluateBlogGenerationResearchReadiness({
        meta: { [BLOG_INFORMATION_RESEARCH_META_KEY]: bundle },
        expectedContentKey: '미국-entry',
        destination: '미국',
        intent: 'entry_requirements',
        locale: 'ko-KR',
        sourcePolicy: contract.sourcePolicy,
        now: new Date('2026-07-20T00:00:00.000Z'),
      });

    const completeResult = evaluate(complete);
    expect(completeResult.issues).not.toContain(
      'claim_semantic_coverage_missing:entry_requirements:permitted_purpose',
    );
    expect(completeResult.issues).not.toContain(
      'claim_semantic_coverage_missing:entry_requirements:permitted_stay',
    );
    expect(completeResult.issues).not.toContain(
      'claim_semantic_coverage_missing:entry_requirements:supporting_return',
    );
    expect(completeResult.issues).not.toContain(
      'claim_semantic_coverage_missing:entry_requirements:supporting_lodging',
    );
    expect(completeResult.issues).not.toContain(
      'claim_semantic_coverage_missing:entry_requirements:supporting_financial',
    );
    expect(completeResult.issues).not.toContain(
      'claim_semantic_coverage_missing:entry_requirements:customs_declaration',
    );

    const missingPurpose = structuredClone(complete);
    missingPurpose.claims[0] = {
      ...missingPurpose.claims[0]!,
      claimText: '미국 비자면제 입국에는 전자여권이 필요합니다.',
    };
    const missingPurposeResult = evaluate(missingPurpose);
    expect(missingPurposeResult.issues).toContain(
      'claim_semantic_coverage_missing:entry_requirements:permitted_purpose',
    );
    expect(missingPurposeResult.issues).not.toContain(
      'claim_semantic_coverage_missing:entry_requirements:permitted_stay',
    );

    const missingSupportingDocuments = structuredClone(complete);
    missingSupportingDocuments.claims[2] = {
      ...missingSupportingDocuments.claims[2]!,
      claimText: '미국 입국 전 최신 안내를 확인해야 합니다.',
    };
    expect(evaluate(missingSupportingDocuments).issues).toContain(
      'claim_semantic_coverage_missing:entry_requirements:supporting_return',
    );
    expect(evaluate(missingSupportingDocuments).issues).toContain(
      'claim_semantic_coverage_missing:entry_requirements:supporting_lodging',
    );
    expect(evaluate(missingSupportingDocuments).issues).toContain(
      'claim_semantic_coverage_missing:entry_requirements:supporting_financial',
    );

    const missingCustomsDeclaration = structuredClone(complete);
    missingCustomsDeclaration.claims[3] = {
      ...missingCustomsDeclaration.claims[3]!,
      claimText: '미국 입국 전 최신 안내를 확인해야 합니다.',
    };
    expect(evaluate(missingCustomsDeclaration).issues).toContain(
      'claim_semantic_coverage_missing:entry_requirements:customs_declaration',
    );
  });

  it('blocks missing research before writing starts', () => {
    expect(readiness(null)).toMatchObject({
      passed: false,
      issues: ['research_bundle_missing_or_invalid_shape'],
    });
  });

  it('accepts a complete food-budget evidence pack', () => {
    const result = readiness(foodBudgetBundle());
    expect(result.passed).toBe(true);
    expect(result.summary).toMatchObject({
      sourceCount: 1,
      evidenceCount: 7,
      claimCount: 7,
      supportedClaimCount: 7,
      distinctNormalizedValueCount: 7,
    });
  });

  it('blocks content scope drift and incomplete meal/tier coverage', () => {
    const bundle = foodBudgetBundle(6);
    bundle.contentKey = 'wrong-slug';
    bundle.evidence[0].scope.destination = '도쿄';
    const result = readiness(bundle);

    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'content_key_mismatch',
      'evidence_destination_mismatch:sapporo-food-price-1',
      'claim_type_below_minimum:price:6/7',
    ]));
  });

  it('blocks stale or unclassified sources', () => {
    const bundle = foodBudgetBundle();
    bundle.sources[0].retrievedAt = '2026-01-01T00:00:00.000Z';
    bundle.sources[0].claimTypes = [];
    bundle.sources[0].contentHash = createBlogInformationSourceContentHash(bundle.sources[0].snapshotContent);
    const result = readiness(bundle);

    expect(result.issues).toEqual(expect.arrayContaining([
      'source_claim_types_missing:sapporo-food-field-research',
      'source_stale:sapporo-food-field-research',
    ]));
  });

  it('accepts a current reputable price source for food budgets', () => {
    const bundle = foodBudgetBundle();
    bundle.sources[0].sourceType = 'reputable_price_source';
    bundle.sources[0].authorityLevel = 'editorial_secondary';
    bundle.sources[0].sourceUrl = 'https://www.budgetyourtrip.com/japan/sapporo';
    delete bundle.sources[0].internalIdentifier;

    expect(readiness(bundle).issues).not.toContain(
      'source_type_not_allowed:sapporo-food-field-research',
    );
  });

  it('blocks seven unrelated price claims that do not cover the required food-budget decisions', () => {
    const bundle = foodBudgetBundle();
    bundle.claims = bundle.claims.map((claim, index) => {
      const claimText = `삿포로 일반 여행자의 가격 참고값 ${index + 1}은 ${claim.extractedValue?.normalizedValue} JPY입니다.`;
      return {
        ...claim,
        claimText,
        claimFingerprint: createBlogInformationClaimFingerprint(claimText),
      };
    });

    const result = readiness(bundle);
    expect(result.passed).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      'claim_semantic_coverage_missing:food_budget:budget_tier',
      'claim_semantic_coverage_missing:food_budget:breakfast',
      'claim_semantic_coverage_missing:food_budget:snack',
    ]));
  });

  it('blocks semantically irrelevant itinerary and souvenir evidence packs', () => {
    const unrelated = foodBudgetBundle();
    unrelated.claims = unrelated.claims.map((claim, index) => {
      const claimText = `일반 생활비 참고값 ${index + 1}은 ${claim.extractedValue?.normalizedValue} JPY입니다.`;
      return {
        ...claim,
        claimText,
        claimFingerprint: createBlogInformationClaimFingerprint(claimText),
      };
    });
    const evaluateIntent = (intent: 'itinerary' | 'shopping_souvenirs') =>
      evaluateBlogGenerationResearchReadiness({
        meta: { [BLOG_INFORMATION_RESEARCH_META_KEY]: unrelated },
        expectedContentKey: CONTENT_KEY,
        destination: '삿포로',
        intent,
        locale: 'ko-KR',
        sourcePolicy: FOOD_POLICY,
        now: new Date('2026-07-19T12:00:00.000Z'),
      });

    expect(evaluateIntent('itinerary').issues).toEqual(expect.arrayContaining([
      'claim_semantic_coverage_missing:itinerary:child_or_family',
      'claim_semantic_coverage_missing:itinerary:attraction',
      'claim_semantic_coverage_missing:itinerary:route_duration',
    ]));
    expect(evaluateIntent('shopping_souvenirs').issues).toEqual(expect.arrayContaining([
      'claim_semantic_coverage_missing:shopping_souvenirs:souvenir_product',
      'claim_semantic_coverage_missing:shopping_souvenirs:purchase_location',
      'claim_semantic_coverage_missing:shopping_souvenirs:customs',
    ]));
  });

  it('blocks transport research that has numbers but not the operating decisions', () => {
    const unrelated = foodBudgetBundle();
    const evaluateIntent = (intent: 'airport_transport' | 'local_transport') =>
      evaluateBlogGenerationResearchReadiness({
        meta: { [BLOG_INFORMATION_RESEARCH_META_KEY]: unrelated },
        expectedContentKey: CONTENT_KEY,
        destination: '\uC0BF\uD3EC\uB85C',
        intent,
        locale: 'ko-KR',
        sourcePolicy: FOOD_POLICY,
        now: new Date('2026-07-19T12:00:00.000Z'),
      });

    expect(evaluateIntent('airport_transport').issues).toEqual(expect.arrayContaining([
      'claim_semantic_coverage_missing:airport_transport:multiple_modes',
      'claim_semantic_coverage_missing:airport_transport:operating_hours',
      'claim_semantic_coverage_missing:airport_transport:luggage',
      'claim_semantic_coverage_missing:airport_transport:late_arrival',
    ]));
    expect(evaluateIntent('local_transport').issues).toEqual(expect.arrayContaining([
      'claim_semantic_coverage_missing:local_transport:route',
      'claim_semantic_coverage_missing:local_transport:frequency_schedule',
      'claim_semantic_coverage_missing:local_transport:ticket_or_reservation',
      'claim_semantic_coverage_missing:local_transport:service_limitation',
    ]));
  });

  it('recognizes operator route and fare claims as family transport evidence', () => {
    const bundle = foodBudgetBundle();
    bundle.claims[0] = {
      ...bundle.claims[0],
      claimText: 'GRTA Route 14의 공항 출발 구간은 5분이며 일반 1회 탑승 요금은 1.50 USD이다.',
      claimFingerprint: createBlogInformationClaimFingerprint(
        'GRTA Route 14의 공항 출발 구간은 5분이며 일반 1회 탑승 요금은 1.50 USD이다.',
      ),
    };

    const result = evaluateBlogGenerationResearchReadiness({
      meta: { [BLOG_INFORMATION_RESEARCH_META_KEY]: bundle },
      expectedContentKey: CONTENT_KEY,
      destination: '삿포로',
      intent: 'family_budget',
      locale: 'ko-KR',
      sourcePolicy: FOOD_POLICY,
      now: new Date('2026-07-19T12:00:00.000Z'),
    });

    expect(result.issues).not.toContain(
      'claim_semantic_coverage_missing:family_budget:transport',
    );
  });

  it('requires complete 1~12 month climate coverage before weather writing starts', () => {
    const incomplete = monthlyWeatherReadiness(monthlyWeatherBundle(6));
    expect(incomplete.passed).toBe(false);
    expect(incomplete.issues).toEqual(expect.arrayContaining([
      'claim_type_below_minimum:climate:6/12',
      'claim_semantic_coverage_missing:monthly_weather:month_7',
      'claim_semantic_coverage_missing:monthly_weather:month_12',
    ]));

    const complete = monthlyWeatherReadiness(monthlyWeatherBundle());
    expect(complete.issues).toEqual([]);
    expect(complete.passed).toBe(true);
    expect(complete.summary).toMatchObject({
      claimCount: 12,
      supportedClaimCount: 12,
      distinctNormalizedValueCount: 12,
    });
    expect(complete.bundle?.evidence[0]?.scope).toMatchObject({
      normalizedValue: '29.0|24.0|100.0|18.0',
      unit: '월별 기후 지표',
      currency: null,
    });
    expect(complete.bundle?.claims[0]?.extractedValue).toEqual({
      normalizedValue: '29.0|24.0|100.0|18.0',
      unit: '월별 기후 지표',
      currency: null,
    });
  });

  it('repairs the final weather article with one verified 12-month table', () => {
    const result = monthlyWeatherReadiness(monthlyWeatherBundle());
    const original = [
      '# 괌 7월 날씨와 옷차림',
      '괌 여행 전에는 기후 평년값과 단기예보를 나눠 확인하세요.',
    ].join('\n\n');
    const originalWithImages = [
      original,
      '![괌 7월 날씨 참고 1](https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg)',
      '![괌 7월 날씨 참고 2](https://images.pexels.com/photos/1002/pexels-photo-1002.jpeg)',
      '![괌 7월 날씨 참고 3](https://images.pexels.com/photos/1003/pexels-photo-1003.jpeg)',
    ].join('\n\n');
    const first = repairBlogGenerationResearchStructure({
      markdown: originalWithImages,
      intent: 'monthly_weather',
      readiness: result,
    });
    const second = repairBlogGenerationResearchStructure({
      markdown: first.markdown,
      intent: 'monthly_weather',
      readiness: result,
    });

    expect(first.changed).toBe(true);
    expect(first.approvedClaims).toHaveLength(12);
    expect(first.markdown).toContain('| 1월 | 1981~2010 평년값: 1월 최고기온 29.0°C');
    expect(first.markdown).toContain('| 12월 | 1981~2010 평년값: 12월 최고기온 30.1°C');
    expect(first.markdown).toContain('통풍되는 반팔과 냉방용 얇은 겉옷, 우산과 방수 겉옷');
    expect(extractFaqItems(first.markdown)).toHaveLength(3);
    expect(first.markdown.length).toBeGreaterThanOrEqual(2500);
    expect(extractBlogInformationClaims(first.markdown)).toHaveLength(12);
    expect(extractBlogInformationClaims(first.markdown).every((claim) => claim.claimType === 'climate')).toBe(true);
    expect(checkHook(first.markdown).passed).toBe(true);
    expect(checkLinks(first.markdown, 'https://www.yeosonam.com').passed).toBe(true);
    expect(checkArticleQualityV2({
      blog_html: first.markdown,
      slug: WEATHER_CONTENT_KEY,
      blog_type: 'info',
    }).passed).toBe(true);
    expect(computeReadability(first.markdown).duplicate_phrases).toEqual([]);
    const semanticCoverage = computeSeoScore({
      blogHtml: first.markdown,
      slug: WEATHER_CONTENT_KEY,
      seoTitle: '괌 7월 날씨와 옷차림',
      seoDescription: '괌 월별 기온, 강수량, 옷차림과 준비물을 공식 자료로 확인합니다.',
      primaryKeyword: '괌 7월 날씨',
      destination: '괌',
      blogType: 'info',
      hasRenderedPageH1: true,
      hasRuntimeInformationalCta: true,
      hasJsonLd: {
        blogPosting: true,
        faqPage: true,
        howTo: false,
        breadcrumbList: true,
      },
    }).details.find((detail) => detail.name === 'semantic_longtail_coverage');
    expect(semanticCoverage).toMatchObject({
      status: 'pass',
    });
    expect(semanticCoverage?.score).toBeGreaterThanOrEqual(6);
    expect(inspectBlogImageQuality(first.markdown, {
      destination: '괌',
      primaryKeyword: '괌 7월 날씨',
      blogType: 'info',
    }).passed).toBe(true);
    expect(inspectBlogInformationMarkdown({
      markdown: first.markdown,
      contract: buildBlogInformationContract({
        intentType: 'monthly_weather',
        destination: '괌',
        topic: '괌 7월 날씨와 옷차림',
        primaryKeyword: '괌 7월 날씨',
        category: 'weather',
        microAngle: 'weather_packing',
      }),
    }).missingSlots).not.toContain('season_risk');
    const publicSurface = repairBlogFinalCustomerSurface({
      destination: '괌',
      primaryKeyword: '괌 월별 날씨',
      markdown: first.markdown,
    });
    expect(extractFaqItems(publicSurface.markdown)).toHaveLength(3);
    expect(validateBlogInformationStructure({
      intent: 'monthly_weather',
      markdown: first.markdown,
    })).toMatchObject({ passed: true, issues: [] });
    expect(second.changed).toBe(false);
    expect(second.markdown).toBe(first.markdown);

    const repairedGenericLead = repairBlogGenerationResearchStructure({
      markdown: `괌, 먼저 무엇을 확인해야 할까요? 일정과 비용을 비교하세요.\n\n${first.markdown}`,
      intent: 'monthly_weather',
      readiness: result,
    });
    expect(repairedGenericLead.changed).toBe(true);
    expect(repairedGenericLead.markdown).toMatch(
      /^<!-- blog_research_structure:monthly_weather:v2 -->\n# /,
    );
    expect(checkArticleQualityV2({
      blog_html: repairedGenericLead.markdown,
      slug: WEATHER_CONTENT_KEY,
      blog_type: 'info',
    }).passed).toBe(true);

    const regressedMarkdown = first.markdown.replace(
      '<!-- /blog_research_structure:monthly_weather:v2 -->',
      '',
    );
    expect(regressedMarkdown).not.toContain(
      '<!-- /blog_research_structure:monthly_weather:v2 -->',
    );

    const repairedAfterLaterRegression = repairBlogGenerationResearchStructure({
      markdown: regressedMarkdown,
      intent: 'monthly_weather',
      readiness: result,
    });
    expect(repairedAfterLaterRegression.changed).toBe(true);
    expect(repairedAfterLaterRegression.markdown).toContain(
      'https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg',
    );
    expect(repairedAfterLaterRegression.markdown).toContain(
      'https://images.pexels.com/photos/1002/pexels-photo-1002.jpeg',
    );
    expect(repairedAfterLaterRegression.markdown).toContain(
      'https://images.pexels.com/photos/1003/pexels-photo-1003.jpeg',
    );
    expect(inspectBlogImageQuality(repairedAfterLaterRegression.markdown, {
      destination: '괌',
      primaryKeyword: '괌 7월 날씨',
      blogType: 'info',
    }).passed).toBe(true);
  });

  it('uses the approved brief title instead of an unledgered AI date headline', () => {
    const result = monthlyWeatherReadiness(monthlyWeatherBundle());
    const repaired = repairBlogGenerationResearchStructure({
      markdown: '# 보홀 날씨 2026년 6월 최신판',
      intent: 'monthly_weather',
      readiness: result,
      plannedTitle: '보홀 6월 날씨와 옷차림',
    });

    expect(repaired.markdown).toContain('# 보홀 6월 날씨와 옷차림');
    expect(repaired.markdown).not.toContain('2026년 6월 최신판');
    expect(extractBlogInformationClaims(repaired.markdown)).toHaveLength(12);
  });

  it('uses verified temperatures instead of rainfall alone for cold-weather clothing', () => {
    const result = monthlyWeatherReadiness(monthlyWeatherBundle());
    result.bundle!.claims[0]!.claimText =
      '1991~2020 평년값: 1월 최고기온 -0.4°C, 최저기온 -6.4°C, 강수량 108.4mm, 강수일수 22.4일';
    const repaired = repairBlogGenerationResearchStructure({
      markdown: '# 삿포로 월별 날씨와 옷차림',
      intent: 'monthly_weather',
      readiness: result,
    });

    expect(repaired.markdown).toContain(
      '| 1월 | 발열 내의와 니트, 두꺼운 방한 외투와 장갑 |',
    );
    expect(repaired.markdown).not.toContain('| 1월 | 반팔');
  });

  it('injects exact approved evidence and claims without copying snapshots into compact metadata', () => {
    const result = readiness(foodBudgetBundle());
    const prompt = buildBlogGenerationResearchPromptBlock(result);
    const summary = JSON.stringify(summarizeBlogGenerationResearch(result));

    expect(prompt).toContain('Verified research evidence pack');
    expect(prompt).toContain('2026년 일본 삿포로 일반 여행자의 절약형 하루 예산 기준값은 3000 JPY입니다.');
    expect(prompt).toContain('삿포로 일반 여행자의 절약형 하루 예산 기준값은 3000 JPY입니다.');
    expect(prompt).toContain('never add a new number');
    expect(summary).not.toContain('삿포로 식비 현장 조사');
    expect(summary).not.toContain('절약형 하루 예산 기준값');
  });

  it('moves approved food-budget claims into deterministic tier and meal tables', () => {
    const result = readiness(foodBudgetBundle());
    const original = [
      '# 삿포로 식비 예산',
      '2026-07-19 조사 기준입니다.',
      '3박 4일 여행 총액은 일정에 맞춰 확인하세요.',
      '출처: https://www.budgetyourtrip.com/japan/sapporo',
      ...result.bundle!.claims.map((claim) => `- ${claim.claimText}`),
    ].join('\n\n');

    expect(validateBlogInformationStructure({ intent: 'food_budget', markdown: original }).passed).toBe(false);

    const repaired = repairBlogGenerationResearchStructure({
      markdown: original,
      intent: 'food_budget',
      readiness: result,
    });
    const report = validateBlogInformationStructure({ intent: 'food_budget', markdown: repaired.markdown });

    expect(repaired.changed).toBe(true);
    expect(repaired.approvedClaims).toHaveLength(7);
    expect(repaired.markdown).toContain('| 절약 | 3,000 JPY |');
    expect(repaired.markdown).toContain('| 아침 | 700 JPY |');
    expect(repaired.markdown).toContain('## 지역별 가격 차이 확인 방법');
    expect(repaired.markdown).toContain('이 자료는 도시 전체 평균');
    expect(repaired.markdown).toContain('## 세금·서비스료·예약 조건은 어떻게 확인할까?');
    expect(repaired.markdown).toContain('현재 가격 근거 묶음에는 업장별 세금·서비스료·예약 조건이 포함되어 있지 않습니다.');
    expect(repaired.markdown).toContain('세금 포함 여부, 서비스료, 예약·취소 조건을 확인하세요.');
    expect(repaired.markdown.match(/삿포로 일반 여행자의 절약형 하루 예산 기준값은 3000 JPY입니다\./g) ?? []).toHaveLength(0);
    expect(report).toMatchObject({ passed: true, issues: [] });
    const informationReport = inspectBlogInformationMarkdown({
      markdown: repaired.markdown,
      contract: buildBlogInformationContract({
        intentType: 'food_budget',
        destination: '삿포로',
        topic: '삿포로 식비 예산',
        primaryKeyword: '삿포로 식비',
        category: 'food',
        microAngle: 'food_budget',
      }),
    });
    expect(informationReport.missingSlots).not.toContain('fees_and_booking');
  });

  it('turns verified local-transport claims into a complete customer decision table', () => {
    const researchReadiness = localTransportReadiness();
    expect(researchReadiness.issues).toEqual([]);
    expect(researchReadiness.passed).toBe(true);
    const vehicleRestrictionClaim = researchReadiness.bundle!.claims.find((claim) =>
      claim.claimText.includes('모레인 호수 도로는 연중 개인 차량 통행이 금지'))!.claimText;
    const reservationClaim = researchReadiness.bundle!.claims.find((claim) =>
      claim.claimText.includes('8X 서비스만 예약이 가능'))!.claimText;

    const repaired = repairBlogGenerationResearchStructure({
      markdown: [
        '# 캐나다 로키산맥 렌터카 없이 이동하기',
        '밴프와 레이크 루이스를 연결하는 대중교통을 비교합니다.',
        vehicleRestrictionClaim,
        vehicleRestrictionClaim,
        vehicleRestrictionClaim,
        `| ${vehicleRestrictionClaim} |`,
        `| ${reservationClaim} |`,
        '![캐나다 로키 교통 1](https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg)',
        '![캐나다 로키 교통 2](https://images.pexels.com/photos/1002/pexels-photo-1002.jpeg)',
        '![캐나다 로키 교통 3](https://images.pexels.com/photos/1003/pexels-photo-1003.jpeg)',
      ].join('\n\n'),
      intent: 'local_transport',
      readiness: researchReadiness,
    });
    const structureReport = validateBlogInformationStructure({
      intent: 'local_transport',
      markdown: repaired.markdown,
    });
    const informationReport = inspectBlogInformationMarkdown({
      markdown: repaired.markdown,
      contract: buildBlogInformationContract({
        intentType: 'local_transport',
        destination: '캐나다 로키산맥',
        topic: '캐나다 로키산맥 렌터카 없이 대중교통 여행',
        primaryKeyword: '캐나다 로키산맥 대중교통',
        category: 'transport',
        microAngle: 'local_mobility',
      }),
    });

    expect(repaired.changed).toBe(true);
    expect(repaired.changes).toContain('local_transport_deterministic_evidence_article');
    expect(repaired.markdown.trimStart()).toMatch(/^<!-- blog_research_structure:local_transport:v1 -->/);
    expect(repaired.markdown).not.toContain('밴프와 레이크 루이스를 연결하는 대중교통을 비교합니다.');
    expect(repaired.markdown.length).toBeGreaterThan(2500);
    expect(repaired.markdown).toContain('| Roam Transit 8X 이동 | 12.50 CAD');
    expect(repaired.markdown).toContain('| Parks Canada 셔틀 | 12.75 CAD');
    expect(repaired.markdown).toContain('약 57분 소요');
    expect(repaired.markdown).toContain('최대 2시간 대기');
    expect(repaired.markdown).toContain('연중 매일 직행 연결을 제공합니다.');
    expect(repaired.markdown).toContain('8X 서비스만 예약이 가능합니다.');
    expect(extractFaqItems(repaired.markdown)).toHaveLength(3);
    expect(repaired.markdown).toContain('https://parks.canada.ca/');
    expect(repaired.markdown).toContain('https://roamtransit.com/');
    expect(repaired.markdown).toContain('[여소남 여행지 가이드](/destinations)');
    expect(summarizeBlogGenerationResearch(researchReadiness).official_source_urls)
      .toEqual(expect.arrayContaining([
        expect.stringContaining('parks.canada.ca/'),
        expect.stringContaining('roamtransit.com/'),
      ]));
    expect(repaired.markdown.match(new RegExp(vehicleRestrictionClaim, 'g')) ?? []).toHaveLength(2);
    expect(computeReadability(repaired.markdown).duplicate_phrases.every((item) => item.count < 5))
      .toBe(true);
    expect(inspectBlogCustomerQuality({
      blogHtml: repaired.markdown,
      blogType: 'info',
      title: '캐나다 로키산맥 대중교통 여행',
      primaryKeyword: '캐나다 로키산맥 대중교통',
      destination: '캐나다 로키산맥',
      generationMeta: { writer: 'info_writer' },
    }).issues.map((issue) => issue.code)).not.toContain('table_render_risk');
    expect(structureReport).toMatchObject({ passed: true, issues: [] });
    expect(informationReport).toMatchObject({
      passed: true,
      missingSlots: [],
      structuredIssues: [],
    });
    const seoInput = {
      blogHtml: repaired.markdown,
      slug: '캐나다-로키산맥-7월-여행-렌터카-없이-대중교통으로-가능할까',
      seoTitle: '캐나다 로키산맥 대중교통 여행: 렌터카 없이 이동하는 법',
      seoDescription: '캐나다 로키산맥에서 렌터카 없이 이동할 때 필요한 공식 셔틀 요금, 소요시간, 운행 확인, 승차권 예약 조건을 근거와 함께 정리합니다.',
      primaryKeyword: '캐나다 로키산맥 대중교통',
      secondaryKeywords: ['밴프 셔틀', '레이크 루이스 버스'],
      destination: '캐나다 로키산맥',
      blogType: 'info' as const,
      hasRuntimeInformationalCta: true,
      hasRenderedPageH1: true,
      imageCount: 3,
      imagesWithAlt: 3,
    };
    const seoWithFaq = computeSeoScore({
      ...seoInput,
      hasJsonLd: {
        blogPosting: true,
        breadcrumbList: true,
        faqPage: extractFaqItems(repaired.markdown).length > 0,
        howTo: false,
      },
    });
    const seoWithoutFaq = computeSeoScore({
      ...seoInput,
      hasJsonLd: {
        blogPosting: true,
        breadcrumbList: true,
        faqPage: false,
        howTo: false,
      },
    });
    expect(seoWithFaq.score - seoWithoutFaq.score).toBe(2);
    expect(seoWithFaq.details.find((detail) => detail.name === 'structured_data'))
      .toMatchObject({ score: 7, status: 'pass' });
    const productionBoundarySeoInput = {
      ...seoInput,
      secondaryKeywords: [],
      hasJsonLd: {
        blogPosting: true,
        breadcrumbList: true,
        faqPage: true,
        howTo: false,
      },
    };
    const productionBoundarySeoWithoutSourceHandoff = computeSeoScore(productionBoundarySeoInput);
    const productionBoundarySeo = computeSeoScore({
      ...productionBoundarySeoInput,
      generationMeta: {
        information_research_preflight: summarizeBlogGenerationResearch(researchReadiness),
      },
    });
    expect(productionBoundarySeo.details.find((detail) => detail.name === 'semantic_longtail_coverage'))
      .toMatchObject({ score: 6, status: 'pass' });
    expect(productionBoundarySeo.details.find((detail) => detail.name === 'external_authority_links'))
      .toMatchObject({ score: 6, status: 'pass' });
    expect(productionBoundarySeo.score - productionBoundarySeoWithoutSourceHandoff.score).toBe(3);

    const second = repairBlogGenerationResearchStructure({
      markdown: repaired.markdown,
      intent: 'local_transport',
      readiness: researchReadiness,
    });
    expect(second.changed).toBe(false);
    expect(second.markdown).toBe(repaired.markdown);
  });

  it('replaces conflicting model tables and escaped newlines with one clean deterministic block', async () => {
    const result = readiness(foodBudgetBundle());
    const modelClaimRows = result.bundle!.claims.map((claim) => `| ${claim.claimText} |`).join('\n');
    const repaired = repairBlogGenerationResearchStructure({
      markdown: [
        '# 삿포로 식비 예산',
        '여행 전 예산 범위를 먼저 확인하세요.',
        '### 근거로 확인한 1인 하루 식비',
        modelClaimRows,
        '![삿포로 식비 예산 표](https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg)',
        '<figcaption>삿포로 식비 예산 참고 이미지</figcaption>',
        '![삿포로 끼니별 가격](https://images.pexels.com/photos/1002/pexels-photo-1002.jpeg)',
        '<figcaption>삿포로 끼니별 가격 참고 이미지</figcaption>',
        '![삿포로 예약 전 확인](https://images.pexels.com/photos/1003/pexels-photo-1003.jpeg)',
        '<figcaption>삿포로 예약 전 확인 참고 이미지</figcaption>',
        '\\n##',
        '## 예약 전 확인 메모',
        '메뉴와 예약 화면의 최신 조건을 확인하세요.',
      ].join('\n'),
      intent: 'food_budget',
      readiness: result,
    });

    expect(repaired.markdown.match(/^#{2,6}\s+근거로 확인한 1인 하루 식비$/gm)).toHaveLength(1);
    expect(repaired.markdown).not.toContain('\\n');
    expect(repaired.markdown).not.toMatch(/^\s*#{1,6}\s*$/m);
    expect(checkMarkdownTableIntegrity(repaired.markdown).passed).toBe(true);
    expect(repaired.markdown.match(/삿포로 일반 여행자의 .* 기준값은 .* JPY입니다\./g) ?? []).toHaveLength(0);
    expect(new Set(
      [...repaired.markdown.matchAll(/!\[[^\]]*]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]),
    ).size).toBe(3);
    expect(repaired.markdown.match(/<figcaption>삿포로/g)).toHaveLength(3);

    const rendered = await renderBlogContentToHtml(repaired.markdown);
    expect(inspectRenderedBlogIntegrity(repaired.markdown, rendered).evidence.artifacts).toEqual([]);
  });

  it('does not rewrite an article whose required food-budget structure already passes', () => {
    const result = readiness(foodBudgetBundle());
    const first = repairBlogGenerationResearchStructure({
      markdown: [
        '# 삿포로 식비 예산',
        '2026-07-19 조사 기준입니다. 3박 4일 여행 총액을 확인하세요.',
        '출처: https://www.budgetyourtrip.com/japan/sapporo',
      ].join('\n\n'),
      intent: 'food_budget',
      readiness: result,
    });
    const second = repairBlogGenerationResearchStructure({
      markdown: first.markdown,
      intent: 'food_budget',
      readiness: result,
    });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.markdown).toBe(first.markdown);
  });

  it('varies weather openings and headings without adding unsupported claims', () => {
    const readiness = monthlyWeatherReadiness(monthlyWeatherBundle());
    const base = [
      '# 괌 7월 날씨와 옷차림',
      '![괌 참고 1](https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg)',
      '![괌 참고 2](https://images.pexels.com/photos/1002/pexels-photo-1002.jpeg)',
      '![괌 참고 3](https://images.pexels.com/photos/1003/pexels-photo-1003.jpeg)',
    ].join('\n\n');
    const temperatureFirst = repairBlogGenerationResearchStructure({
      markdown: base,
      intent: 'monthly_weather',
      readiness,
      editorialVariation: {
        opening_variant: 'temperature_first',
        section_order_variant: 'weather_then_clothing',
      },
    });
    const packingFirst = repairBlogGenerationResearchStructure({
      markdown: base.replace('# 괌 7월 날씨와 옷차림', '# 괌 월별 날씨와 옷차림'),
      intent: 'monthly_weather',
      readiness,
      editorialVariation: {
        opening_variant: 'packing_mistake_first',
        section_order_variant: 'packing_then_local_risk',
      },
    });

    expect(temperatureFirst.markdown).not.toBe(packingFirst.markdown);
    expect(temperatureFirst.markdown).toMatch(/괌 1~12월 날씨와 옷차림은 어떻게 달라질까요\?/);
    expect(packingFirst.markdown).toMatch(/괌 1~12월 날씨 준비에서 빠뜨리기 쉬운 옷차림은 무엇일까요\?/);
    expect(temperatureFirst.markdown).toContain('## 괌 먼저 확인할 핵심');
    expect(packingFirst.markdown).toContain('## 괌 옷차림을 정하는 확인 순서');
    const sameVariationDifferentDestination = repairBlogGenerationResearchStructure({
      markdown: base.replaceAll('괌', '오키나와'),
      intent: 'monthly_weather',
      readiness,
      editorialVariation: {
        opening_variant: 'temperature_first',
        section_order_variant: 'weather_then_clothing',
      },
    });
    expect(sameVariationDifferentDestination.markdown).toContain('## 오키나와 먼저 확인할 핵심');
    expect(sameVariationDifferentDestination.markdown).not.toContain('## 괌 먼저 확인할 핵심');
    expect(extractBlogInformationClaims(temperatureFirst.markdown)).toHaveLength(12);
    expect(extractBlogInformationClaims(packingFirst.markdown)).toHaveLength(12);
    expect(checkHook(temperatureFirst.markdown).passed).toBe(true);
    expect(checkHook(packingFirst.markdown).passed).toBe(true);
    expect(temperatureFirst.markdown.indexOf('## 1~12월 기온·강수·옷차림'))
      .toBeLessThan(temperatureFirst.markdown.indexOf('## 월별 옷차림 준비표'));
    expect(packingFirst.markdown.indexOf('## 비·바람·이상기후 대비'))
      .toBeLessThan(packingFirst.markdown.indexOf('## 월별 기본 옷차림과 추가 준비'));

    const repeated = repairMonthlyWeatherEditorialVariation(
      packingFirst.markdown,
      {
        contract_version: 3,
        opening_variant: 'packing_mistake_first',
        section_order_variant: 'packing_then_local_risk',
      },
    );
    expect(repeated.changed).toBe(false);
    expect(repeated.markdown).toBe(packingFirst.markdown);
  });

  it('keeps every monthly-weather editorial variation within the 12 approved climate claims', () => {
    const weatherReadiness = monthlyWeatherReadiness(monthlyWeatherBundle());
    const base = [
      '# 보홀 6월 날씨와 옷차림',
      '![보홀 참고 1](https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg)',
      '![보홀 참고 2](https://images.pexels.com/photos/1002/pexels-photo-1002.jpeg)',
      '![보홀 참고 3](https://images.pexels.com/photos/1003/pexels-photo-1003.jpeg)',
    ].join('\n\n');
    const openingVariants = [
      'temperature_first',
      'rain_first',
      'clothing_decision_first',
      'packing_mistake_first',
    ];
    const sectionOrderVariants = [
      'weather_then_clothing',
      'clothing_then_rain',
      'decision_table_first',
      'packing_then_local_risk',
    ];
    const headingCopyVariants = [
      'core_weather_check',
      'departure_weather_basis',
      'packing_decision',
      'clothing_check_order',
      'trip_weather_decision',
      'departure_packing_basis',
      'route_weather_prep',
      'forecast_prep',
    ];

    for (const openingVariant of openingVariants) {
      for (const sectionOrderVariant of sectionOrderVariants) {
        for (const headingCopyVariant of headingCopyVariants) {
          const repaired = repairBlogGenerationResearchStructure({
            markdown: base,
            intent: 'monthly_weather',
            readiness: weatherReadiness,
            plannedTitle: '보홀 6월 날씨 옷차림 여행 준비물 체크리스트',
            editorialVariation: {
              opening_variant: openingVariant,
              section_order_variant: sectionOrderVariant,
              heading_copy_variant: headingCopyVariant,
            },
          });
          const claims = extractBlogInformationClaims(repaired.markdown);

          expect(
            claims,
            `${openingVariant}/${sectionOrderVariant}/${headingCopyVariant}`,
          ).toHaveLength(12);
          expect(claims.every((claim) => claim.claimType === 'climate')).toBe(true);
        }
      }
    }
  });

  it('adds cautious area price guidance without inventing a local price delta', () => {
    const result = readiness(foodBudgetBundle());
    const first = repairBlogGenerationResearchStructure({
      markdown: [
        '# 삿포로 식비 예산',
        '3박 4일 여행 총액은 일정에 맞춰 확인하세요.',
        '출처: https://www.budgetyourtrip.com/japan/sapporo',
        ...result.bundle!.claims.map((claim) => `- ${claim.claimText}`),
      ].join('\n\n'),
      intent: 'food_budget',
      readiness: result,
    });
    const withoutAreaGuidance = first.markdown
      .replace(/## 지역별 가격 차이 확인 방법[\s\S]*?(?=<!-- \/blog_research_structure:food_budget:v1 -->)/, '');
    const repaired = repairBlogGenerationResearchStructure({
      markdown: withoutAreaGuidance,
      intent: 'food_budget',
      readiness: result,
    });

    expect(repaired.changed).toBe(true);
    expect(repaired.markdown).toContain('지역별 가격 차이');
    expect(repaired.markdown).toContain('구체적인 지역별 차액을 단정하지 않습니다');
    expect(repaired.markdown).not.toMatch(/지역별[^\n]*(?:\d[\d,.]*\s*(?:JPY|엔|원|USD|달러))/);
  });

  it('rebuilds a marked research block when a later formatter flattened its tables', async () => {
    const result = readiness(foodBudgetBundle());
    const first = repairBlogGenerationResearchStructure({
      markdown: [
        '# 삿포로 식비 예산',
        '2026-07-19 조사 기준입니다. 3박 4일 여행 총액을 확인하세요.',
        '출처: https://www.budgetyourtrip.com/japan/sapporo',
      ].join('\n\n'),
      intent: 'food_budget',
      readiness: result,
    });
    const flattened = `${first.markdown}\n\n<!-- prompt_version: test -->`
      .replace(/^\|.*\|$/gm, (line) => line.replace(/\|/g, ' / '))
      .replace('<!-- /blog_research_structure:food_budget:v1 -->', '');

    const repaired = repairBlogGenerationResearchStructure({
      markdown: flattened,
      intent: 'food_budget',
      readiness: result,
    });

    expect(repaired.changed).toBe(true);
    expect(repaired.markdown.match(/blog_research_structure:food_budget:v1/g)).toHaveLength(2);
    expect(repaired.markdown.match(/삿포로 일반 여행자의 절약형 하루 예산 기준값은 3000 JPY입니다\./g) ?? []).toHaveLength(0);
    expect(validateBlogInformationStructure({ intent: 'food_budget', markdown: repaired.markdown })).toMatchObject({
      passed: true,
      issues: [],
    });
    const rendered = await renderBlogContentToHtml(repaired.markdown);
    const renderReport = inspectRenderedBlogIntegrity(repaired.markdown, rendered);
    expect(rendered.match(/<table\b/g)).toHaveLength(2);
    expect(renderReport.evidence.artifacts).toEqual([]);
  });
});
