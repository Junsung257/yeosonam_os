import { describe, expect, it } from 'vitest';
import {
  extractBlogInformationClaims,
  validateBlogInformationClaims,
  type PersistedBlogInformationClaimRecord,
} from './blog-information-claim-validator';
import type { BlogInformationClaimLedgerEntry } from './blog-information-claim-ledger';
import type { BlogInformationEvidenceScope } from './blog-information-evidence';

const NOW = new Date('2026-07-15T09:00:00.000Z');

function ledgerFor(markdown: string): BlogInformationClaimLedgerEntry[] {
  return extractBlogInformationClaims(markdown).map((claim) => ({
    claimFingerprint: claim.claimFingerprint,
    claimText: claim.claimText,
    claimType: claim.claimType,
    riskLevel: claim.riskLevel,
  }));
}

function supportedRecord(
  markdown: string,
  options: {
    authorityLevel?: 'official_primary' | 'official_secondary' | 'editorial_secondary';
    retrievedAt?: string;
    validUntil?: string | null;
    validationStatus?: PersistedBlogInformationClaimRecord['validationStatus'];
    sourceVersionId?: string | null;
    scope?: Partial<BlogInformationEvidenceScope>;
    excerpt?: string;
  } = {},
): PersistedBlogInformationClaimRecord {
  const claim = extractBlogInformationClaims(markdown)[0];
  if (!claim) throw new Error('fixture did not produce a claim');
  return {
    claimFingerprint: claim.claimFingerprint,
    claimText: claim.claimText,
    claimType: claim.claimType,
    extractedValue: claim.extractedValue,
    validationStatus: options.validationStatus ?? 'supported',
    evidence: [{
      evidenceKey: 'evidence-1',
      sourceVersionId: options.sourceVersionId === undefined ? 'source-version-1' : options.sourceVersionId,
      claimType: claim.claimType,
      observedAt: '2026-07-15T08:00:00.000Z',
      validUntil: options.validUntil ?? '2026-08-15T00:00:00.000Z',
      excerpt: options.excerpt ?? `2026년 일본 오사카 KR 대상: ${markdown}`,
      scope: {
        country: '일본',
        destination: '오사카',
        applicableTo: 'KR',
        locale: 'ko-KR',
        claimType: claim.claimType,
        normalizedValue: claim.extractedValue.normalizedValue,
        unit: claim.extractedValue.unit,
        currency: claim.extractedValue.currency,
        verifiedAt: '2026-07-15T08:00:00.000Z',
        nextReviewAt: options.validUntil ?? '2026-08-15T00:00:00.000Z',
        conditions: ['일반 여행자 기준'],
        ...options.scope,
      },
      source: {
        authorityLevel: options.authorityLevel ?? 'official_primary',
        retrievedAt: options.retrievedAt ?? '2026-07-15T08:00:00.000Z',
        validUntil: options.validUntil ?? '2026-08-15T00:00:00.000Z',
        status: 'active',
      },
    }],
  };
}

describe('blog information claim validator', () => {
  it.each([
    '오사카 지하철은 자정 무렵 운행을 마칩니다.',
    '주말에는 운행하지 않습니다.',
    '공항철도가 택시보다 빠릅니다.',
    '성수기에는 예약이 필요합니다.',
    '재고가 없으면 조기 종료됩니다.',
    '이 지역은 밤에도 안전합니다.',
    '현재 이 서비스를 사용할 수 없습니다.',
    '대기 시간이 길지 않습니다.',
    '현금만 사용할 수 있습니다.',
  ])('fails closed for an unledgered factual statement: %s', (markdown) => {
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [],
      claimLedger: [],
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unclassified_factual_candidate' }),
    ]));
  });

  it.each([
    '여행 스타일에 따라 선택이 달라질 수 있습니다.',
    '아래 표에서 선택지를 비교해 보세요.',
    '# 오사카 이동 가이드',
    '## 목차',
    '[공식 사이트에서 자세히 보기](https://example.com)',
    '저는 골목을 천천히 걷는 일정이 더 좋다고 생각합니다.',
  ])('allows clearly non-factual editorial or navigation text: %s', (markdown) => {
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [],
      claimLedger: [],
      now: NOW,
    });

    expect(report.passed).toBe(true);
    expect(report.claims).toEqual([]);
  });

  it.each([
    ['식비는 하루 8,000엔입니다.', 'price'],
    ['공항에서 시내까지 약 50분이 걸립니다.', 'duration'],
    ['서비스 수수료는 3.5%입니다.', 'percentage'],
    ['7월 평균 기온은 28℃입니다.', 'climate'],
    ['면세 한도는 800달러까지 허용됩니다.', 'customs'],
    ['한국인은 관광 비자가 필요하지 않습니다.', 'entry_visa'],
    ['여행자 보험은 해외 의료비를 보장합니다.', 'insurance'],
    ['이 지역이 가장 저렴합니다.', 'superlative'],
  ] as const)('extracts %s as %s', (markdown, claimType) => {
    expect(extractBlogInformationClaims(markdown)).toEqual([
      expect.objectContaining({ claimType, claimText: markdown }),
    ]);
  });

  it('does not treat ordinary narrative, years, outline numbers, or itinerary ordinals as claims', () => {
    expect(extractBlogInformationClaims('골목을 천천히 걸으며 현지 분위기를 살펴보세요.')).toEqual([]);
    expect(extractBlogInformationClaims('3일 차에는 가장 먼저 시장을 둘러보세요.')).toEqual([]);
    expect(extractBlogInformationClaims('2026년 여행 가이드')).toEqual([]);
    expect(extractBlogInformationClaims('1. 준비\n2. 출발\n첫 번째로 동선을 정하세요.')).toEqual([]);
  });

  it('does not turn reading guidance and freshness reminders into unsupported claims', () => {
    const guidance = [
      '낮과 밤 기온, 비 예보, 일교차를 먼저 봐야 옷차림 실수를 줄일 수 있습니다.',
      '처음 읽는 분은 표와 체크리스트를 먼저 보고, 세부 설명은 필요한 부분만 골라 읽으면 됩니다.',
      '먼저 3줄 요약을 보고, 표에서 비용과 이동 시간을 확인한 뒤, 마지막 체크리스트만 저장해도 됩니다.',
      '숫자는 확정값이 아니라 비교 기준입니다.',
      '출발 7일 전과 24시간 전에는 공식 안내와 예약 조건을 다시 확인하세요.',
    ].join('\n');

    expect(extractBlogInformationClaims(guidance)).toEqual([]);
  });

  it.each([
    ['공항에서 시내까지 거리는 42km입니다.', 'distance'],
    ['영업은 매일 09:00~18:00입니다.', 'time_schedule'],
    ['현재 예약 가능합니다.', 'availability_status'],
    ['택시비는 ₩50,000입니다.', 'money_price'],
    ['여권 사본은 필수 준비물입니다.', 'regulated_policy'],
    ['신고 한도는 2병입니다.', 'regulated_policy'],
    ['체류 가능 기간은 90일입니다.', 'date_period'],
    ['서비스 수수료는 최대 3.5%입니다.', 'percentage'],
  ] as const)('conservatively scans %s as %s', (markdown, candidateKind) => {
    expect(extractBlogInformationClaims(markdown)[0]).toMatchObject({ candidateKind });
  });

  it.each([
    '매일 영업합니다.',
    '주말에는 휴무입니다.',
    '24시간 운영합니다.',
    '체류 기간은 90일입니다.',
    '평균 이동 거리는 12km입니다.',
  ])('detects schedule, period, and qualified-unit adversarial text: %s', (markdown) => {
    expect(extractBlogInformationClaims(markdown)).toHaveLength(1);
  });

  it.each([
    '모바일 결제 비중은 90% 이상입니다.',
    '공항 이동은 약 25분입니다.',
    '리조트 조식은 20가지 이상 제공됩니다.',
    '모기 기피제 효과는 약 4시간입니다.',
    '공항~시내 Grab 요금은 150,000동입니다.',
    '3일 유심 가격은 100,000동입니다.',
    '특정 상품 가격대는 899,000원입니다.',
    '여행 상품은 최소 2~3개월 전 예약을 권고합니다.',
    '국내 입국 면세 한도는 600달러입니다.',
  ])('detects the audit corpus sentence: %s', (markdown) => {
    expect(extractBlogInformationClaims(markdown)).toHaveLength(1);
  });

  it.each(['JPY 1,000', 'KRW 10,000', 'USD 50', 'VND 150,000', 'SGD 20'])
    ('detects ISO currency price %s', (amount) => {
      expect(extractBlogInformationClaims(`예상 비용은 ${amount}입니다.`)[0])
        .toMatchObject({ candidateKind: 'money_price' });
    });

  it('scans claims in tables, lists, body paragraphs, and FAQ answers', () => {
    const markdown = [
      '| 항목 | 값 |',
      '| --- | --- |',
      '| 택시비 | ₩50,000 |',
      '- 신고 한도는 2병입니다.',
      '공항 이동 거리는 42km입니다.',
      '## FAQ',
      '**Q. 예약할 수 있나요?**',
      '현재 예약 가능합니다.',
    ].join('\n');

    expect(extractBlogInformationClaims(markdown).map((claim) => claim.candidateKind))
      .toEqual(expect.arrayContaining(['money_price', 'regulated_policy', 'distance', 'availability_status']));
  });

  it('maps compact deterministic food-budget rows to one uniquely matching persisted claim', () => {
    const claimText = '삿포로 일반 여행자의 절약형 하루 예산 기준값은 3000 JPY입니다.';
    const markdown = [
      '<!-- blog_research_structure:food_budget:v1 -->',
      '## 근거로 확인한 1인 하루 식비',
      '| 예산 유형 | 1인 하루 식비 |',
      '| --- | ---: |',
      '| 절약 | 3,000 JPY |',
      '<!-- /blog_research_structure:food_budget:v1 -->',
    ].join('\n');
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(claimText)],
      claimLedger: ledgerFor(claimText),
      now: NOW,
    });

    expect(report.passed).toBe(true);
    expect(report.claims).toEqual([expect.objectContaining({ claimText })]);
  });

  it('maps a deterministic monthly-weather row back to its exact persisted climate claim', () => {
    const claimText =
      '1981~2010 평년값: 7월 최고기온 30.6°C, 최저기온 24.8°C, 강수량 308.4mm, 강수일수 26.2일';
    const markdown = [
      '<!-- blog_research_structure:monthly_weather:v2 -->',
      '## 1~12월 기온·강수·옷차림',
      '| 월 | 검증된 평년값 | 옷차림 준비 |',
      '| --- | --- | --- |',
      `| 7월 | ${claimText} | 반팔·방수 겉옷·우산 |`,
      '<!-- /blog_research_structure:monthly_weather:v2 -->',
    ].join('\n');
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(claimText)],
      claimLedger: ledgerFor(claimText),
      now: NOW,
    });

    expect(report.passed).toBe(true);
    expect(report.claims).toEqual([
      expect.objectContaining({
        claimText,
        claimType: 'climate',
        extractedValue: {
          normalizedValue: '30.6|24.8|308.4|26.2',
          unit: '월별 기후 지표',
          currency: null,
        },
      }),
    ]);
  });

  it('keeps all monthly climate measurements bound to their composite evidence value', () => {
    const claimText =
      '1991~2013 평년값: 10월 최고기온 32.5°C, 최저기온 24.2°C, 강수량 176.5mm, 강수일수 15일';
    const markdown = [
      '<!-- blog_research_structure:monthly_weather:v2 -->',
      '| 월 | 검증된 평년값 | 옷차림 준비 |',
      '| --- | --- | --- |',
      `| 10월 | ${claimText} | 반팔·우산 |`,
      '<!-- /blog_research_structure:monthly_weather:v2 -->',
    ].join('\n');
    const record = supportedRecord(claimText);
    record.extractedValue = {
      normalizedValue: '32.5|24.2|176.5|15',
      unit: '월별 기후 지표',
      currency: null,
    };
    record.evidence[0]!.scope.normalizedValue = '32.5|24.2|176.5|15';
    record.evidence[0]!.scope.unit = '월별 기후 지표';

    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [record],
      claimLedger: ledgerFor(claimText),
      now: NOW,
    });

    expect(report.passed).toBe(true);
    expect(report.coverage).toBe(1);
    expect(report.issues).toEqual([]);
  });

  it('blocks monthly climate evidence when any composite measurement differs', () => {
    const claimText =
      '1991~2013 평년값: 10월 최고기온 32.5°C, 최저기온 24.2°C, 강수량 176.5mm, 강수일수 15일';
    const record = supportedRecord(claimText);
    record.evidence[0]!.scope.normalizedValue = '32.5|24.2|100|15';
    record.evidence[0]!.scope.unit = '월별 기후 지표';

    const report = validateBlogInformationClaims({
      markdown: claimText,
      persistedClaims: [record],
      claimLedger: ledgerFor(claimText),
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'evidence_semantic_mismatch' }),
    ]);
  });

  it('uses the declared weather claim when stale persisted fragments also match the row', () => {
    const claimText =
      '1981~2010 평년값: 7월 최고기온 30.6°C, 최저기온 24.8°C, 강수량 308.4mm, 강수일수 26.2일';
    const staleFragment = '7월 최고기온 30.6°C, 최저기온 24.8°C';
    const markdown = [
      '<!-- blog_research_structure:monthly_weather:v2 -->',
      '## 1~12월 기온·강수·옷차림',
      '| 월 | 검증된 평년값 | 옷차림 준비 |',
      '| --- | --- | --- |',
      `| 7월 | ${claimText} | 반팔·방수 겉옷·우산 |`,
      '<!-- /blog_research_structure:monthly_weather:v2 -->',
    ].join('\n');
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [
        supportedRecord(claimText, { validationStatus: 'pending' }),
        supportedRecord(staleFragment),
      ],
      claimLedger: ledgerFor(claimText),
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.claims).toEqual([
      expect.objectContaining({ claimText, claimType: 'climate' }),
    ]);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'claim_not_supported' }),
    ]);
  });

  it('fails closed when a compact deterministic value matches more than one persisted claim', () => {
    const first = '삿포로 일반 여행자의 절약형 하루 예산 기준값은 3000 JPY입니다.';
    const second = '삿포로 일반 여행자의 평일 하루 예산 기준값은 3000 JPY입니다.';
    const markdown = [
      '<!-- blog_research_structure:food_budget:v1 -->',
      '## 근거로 확인한 1인 하루 식비',
      '| 예산 유형 | 1인 하루 식비 |',
      '| --- | ---: |',
      '| 절약 | 3,000 JPY |',
      '<!-- /blog_research_structure:food_budget:v1 -->',
    ].join('\n');
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(first), supportedRecord(second)],
      claimLedger: [...ledgerFor(first), ...ledgerFor(second)],
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unclassified_factual_candidate' }),
    ]));
  });

  it('blocks a factual candidate that is missing from the ledger', () => {
    const markdown = '공항에서 시내까지 약 50분이 걸립니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [],
      now: NOW,
    });
    expect(report.passed).toBe(false);
    expect(report.coverage).toBe(0);
    expect(report.issues[0]).toMatchObject({
      code: 'unclassified_factual_candidate',
      claimText: markdown,
    });
  });

  it('blocks a ledgered factual claim without evidence', () => {
    const markdown = '공항에서 시내까지 약 50분이 걸립니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [],
      claimLedger: ledgerFor(markdown),
      now: NOW,
    });
    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('missing_evidence');
  });

  it('blocks when the writer ledger no longer matches the final body', () => {
    const ledger = ledgerFor('공항 이동은 약 25분입니다.');
    const report = validateBlogInformationClaims({
      markdown: '공항 이동은 약 40분입니다.',
      persistedClaims: [],
      claimLedger: ledger,
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'claim_ledger_body_mismatch',
      'unclassified_factual_candidate',
    ]));
  });

  it('does not reuse evidence that expired in 2024 for a 2026 claim', () => {
    const markdown = '공항에서 시내까지 약 50분이 걸립니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown, { validUntil: '2024-12-31T00:00:00.000Z' })],
      now: NOW,
    });
    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('stale_evidence');
  });

  it('blocks legacy evidence that is not pinned to an immutable source version', () => {
    const markdown = 'Estimated cost: USD 50.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown, { sourceVersionId: null })],
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('source_version_required');
  });

  it('blocks policy claims backed only by a secondary editorial source', () => {
    const markdown = '면세 한도는 800달러까지 허용됩니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown, { authorityLevel: 'editorial_secondary' })],
      reviewStatus: 'approved',
      now: NOW,
    });
    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('official_primary_required');
  });

  it('blocks an official high-risk claim until human approval exists', () => {
    const markdown = '한국인은 관광 비자가 필요하지 않습니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown)],
      reviewStatus: 'pending_review',
      now: NOW,
    });
    expect(report.passed).toBe(false);
    expect(report.requiresHumanReview).toBe(true);
    expect(report.issues[0]?.code).toBe('human_approval_required');
  });

  it('passes a current official high-risk claim after human approval', () => {
    const markdown = '한국인은 관광 비자가 필요하지 않습니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown)],
      reviewStatus: 'approved',
      now: NOW,
    });
    expect(report.passed).toBe(true);
    expect(report.coverage).toBe(1);
  });

  it('does not reuse Japan policy evidence for a China claim', () => {
    const markdown = '중국 입국에는 관광 비자가 필요합니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown)],
      reviewStatus: 'approved',
      expectedScope: { destination: '중국', applicableTo: 'KR', locale: 'ko-KR' },
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('evidence_scope_mismatch');
  });

  it('blocks a price when the evidence currency does not match', () => {
    const markdown = '택시비는 50,000원입니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown, {
        scope: { currency: 'USD' },
        excerpt: '2026년 일본 오사카 KR 대상 택시비는 USD 50,000입니다.',
      })],
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('evidence_semantic_mismatch');
  });

  it('blocks an 800 USD claim when the excerpt says 600 USD', () => {
    const markdown = '면세 한도는 800달러까지 허용됩니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown, {
        excerpt: '2026년 일본 오사카 KR 대상 면세 한도는 600 USD입니다.',
      })],
      reviewStatus: 'approved',
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('evidence_semantic_mismatch');
  });

  it('treats official secondary as context only for a high-risk claim', () => {
    const markdown = '한국인은 관광 비자가 필요하지 않습니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown, { authorityLevel: 'official_secondary' })],
      reviewStatus: 'approved',
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('official_primary_required');
  });

  it('requires primary evidence for every claim inside a high-risk insurance intent', () => {
    const markdown = '여행자 보험료는 50,000원입니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown, { authorityLevel: 'official_secondary' })],
      intentType: 'travel_insurance',
      reviewStatus: 'approved',
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues[0]?.code).toBe('official_primary_required');
  });

  it('allows exact primary evidence to reach, but not bypass, human review', () => {
    const markdown = '한국인은 관광 비자가 필요하지 않습니다.';
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [supportedRecord(markdown)],
      reviewStatus: 'pending_review',
      expectedScope: { country: '일본', destination: '오사카', applicableTo: 'KR', locale: 'ko-KR' },
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: 'human_approval_required' }),
    ]);
  });

  it('fails closed when the validator itself receives an invalid runtime value', () => {
    const report = validateBlogInformationClaims({
      markdown: '공항 이동은 약 25분입니다.',
      persistedClaims: null as unknown as PersistedBlogInformationClaimRecord[],
      now: NOW,
    });

    expect(report).toMatchObject({ passed: false, coverage: 0, requiresHumanReview: true });
    expect(report.issues[0]?.code).toBe('validator_error');
  });

  it('does not apply the information validator to product content at the runtime boundary', async () => {
    const { evaluateBlogInformationClaimPublishGate } = await import('./blog-information-claim-publish-gate');
    const report = await evaluateBlogInformationClaimPublishGate({
      contentKey: 'product-post',
      markdown: '가격은 1,000,000원입니다.',
      productId: 'product-1',
    });
    expect(report).toMatchObject({ passed: true, skipped: 'product_content' });
  });
});
