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
  summarizeBlogGenerationResearch,
} from './blog-generation-research';
import { validateBlogInformationStructure } from './blog-information-structure';
import { checkHook, checkLinks, checkMarkdownTableIntegrity } from './blog-quality-gate';
import { inspectBlogImageQuality } from './blog-image-quality';
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

describe('blog generation research preflight', () => {
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
    expect(first.markdown).toContain('반팔·방수 겉옷·우산');
    expect(extractFaqItems(first.markdown)).toHaveLength(3);
    expect(first.markdown.length).toBeGreaterThanOrEqual(2500);
    expect(extractBlogInformationClaims(first.markdown)).toHaveLength(12);
    expect(extractBlogInformationClaims(first.markdown).every((claim) => claim.claimType === 'climate')).toBe(true);
    expect(checkHook(first.markdown).passed).toBe(true);
    expect(checkLinks(first.markdown, 'https://www.yeosonam.com').passed).toBe(true);
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
