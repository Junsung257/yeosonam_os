import { describe, expect, it } from 'vitest';
import {
  classifyBlogInformationStatement,
  countUnsupportedNumericBlogInformationClaims,
  extractBlogInformationClaims,
  inspectBlogInformationClaimTypeCompatibility,
  validateBlogInformationClaims,
  type BlogInformationClaimValidationReport,
  type PersistedBlogInformationClaimRecord,
} from './blog-information-claim-validator';
import type { BlogInformationClaimLedgerEntry } from './blog-information-claim-ledger';
import type { BlogInformationEvidenceScope } from './blog-information-evidence';

const NOW = new Date('2026-07-15T09:00:00.000Z');

describe('rewrite claim type compatibility', () => {
  it('rejects a clock-time claim mislabeled as duration', () => {
    expect(inspectBlogInformationClaimTypeCompatibility(
      '마블 마운틴은 오전 7시 전에 방문하기 좋은 고대 유적지입니다.',
      'duration',
    )).toEqual({
      passed: false,
      declaredType: 'duration',
      deterministicType: 'factual',
      candidateKind: 'time_schedule',
    });
  });

  it('accepts an actual travel duration with the duration type', () => {
    expect(inspectBlogInformationClaimTypeCompatibility(
      '오행산에서 린응사까지는 차로 약 15분이 소요됩니다.',
      'duration',
    )).toEqual({
      passed: true,
      declaredType: 'duration',
      deterministicType: 'duration',
      candidateKind: 'time_schedule',
    });
  });

  it('recognizes a compact Korean duration range as duration', () => {
    expect(inspectBlogInformationClaimTypeCompatibility(
      '마블 마운틴 주요 명소를 둘러보는 데 3~4시간이 소요됩니다.',
      'duration',
    )).toEqual({
      passed: true,
      declaredType: 'duration',
      deterministicType: 'duration',
      candidateKind: 'time_schedule',
    });
  });

  it('classifies a no-fee cancellation claim as price before its time window', () => {
    expect(inspectBlogInformationClaimTypeCompatibility(
      '괌택시 예약 확정 후 5분 이내 취소 시 취소 수수료가 없습니다.',
      'price',
    )).toEqual({
      passed: true,
      declaredType: 'price',
      deterministicType: 'price',
      candidateKind: 'money_price',
    });
  });

  it('accepts an operator-reported nonnumeric service fact as factual', () => {
    expect(inspectBlogInformationClaimTypeCompatibility(
      '카카오 T 괌택시는 예약에 비행편명을 입력하면 항공 지연 때 현지 업체가 도착 시간을 확인해 탑승을 돕는다고 안내한다.',
      'factual',
    )).toEqual({
      passed: true,
      declaredType: 'factual',
      deterministicType: 'factual',
      candidateKind: 'unknown_statement',
    });
  });

  it('fails closed when the publish classifier cannot identify the claim', () => {
    expect(inspectBlogInformationClaimTypeCompatibility(
      '이 장소는 일정의 중심으로 삼기 좋습니다.',
      'factual',
    )).toMatchObject({
      passed: false,
      deterministicType: null,
      candidateKind: null,
    });
  });
});

describe('unsupported numeric claim accounting', () => {
  it('treats a reader-owned route comparison instruction as editorial guidance', () => {
    expect(classifyBlogInformationStatement(
      '이동수단을 고를 때는 GRTA와 카카오 T 괌택시에서 확인된 항목과 비어 있는 항목을 분리해 비교하면 됩니다.',
    )).toEqual({
      category: 'navigation_boilerplate',
      factualClassification: null,
    });
  });

  it('treats the deterministic route answer, route scope title, and fare-product choice as editorial structure', () => {
    for (const sentence of [
      '대중교통 요금을 확인하려면 GRTA 항목을, 현지 택시 요금·공항 승차 위치와 카카오 T 괌택시의 수하물·항공 지연 대응을 확인하려면 택시 항목을 보면 됩니다.',
      '괌 공항 투몬 교통: GRTA·택시 요금과 공항 택시 승차·수하물 안내',
      '1회 탑승과 1일권 중 어느 요금이 자신의 동선에 맞는지는 예상 탑승 횟수를 기준으로 직접 비교하면 됩니다.',
    ]) {
      expect(classifyBlogInformationStatement(sentence)).toEqual({
        category: 'navigation_boilerplate',
        factualClassification: null,
      });
    }
  });

  it('does not relabel a nonnumeric unclassified sentence as an unsupported number', () => {
    const report = {
      passed: false,
      coverage: 0,
      requiresHumanReview: false,
      claims: [{
        claimFingerprint: 'editorial-1',
        claimText: '이곳은 여행자에게 가장 좋은 선택입니다.',
        claimType: 'superlative',
        riskLevel: 'MEDIUM',
        candidateKind: 'superlative',
        extractedValue: {},
      }],
      issues: [{
        code: 'unclassified_factual_candidate',
        claimFingerprint: 'editorial-1',
        claimText: '이곳은 여행자에게 가장 좋은 선택입니다.',
        claimType: 'superlative',
        message: 'ledger에 없음',
      }],
    } as BlogInformationClaimValidationReport;

    expect(countUnsupportedNumericBlogInformationClaims(report)).toBe(0);
  });

  it('counts each unsupported visible numeric claim once', () => {
    const report = {
      passed: false,
      coverage: 0,
      requiresHumanReview: false,
      claims: [{
        claimFingerprint: 'duration-1',
        claimText: '공항에서 도심까지 15분이 걸립니다.',
        claimType: 'duration',
        riskLevel: 'MEDIUM',
        candidateKind: 'time_schedule',
        extractedValue: { normalizedValue: '15', unit: '분' },
      }],
      issues: [
        {
          code: 'unclassified_factual_candidate',
          claimFingerprint: 'duration-1',
          claimText: '공항에서 도심까지 15분이 걸립니다.',
          claimType: 'duration',
          message: 'ledger에 없음',
        },
        {
          code: 'missing_evidence',
          claimFingerprint: 'duration-1',
          claimText: '공항에서 도심까지 15분이 걸립니다.',
          claimType: 'duration',
          message: '근거 없음',
        },
      ],
    } as BlogInformationClaimValidationReport;

    expect(countUnsupportedNumericBlogInformationClaims(report)).toBe(1);
  });
});

describe('V3 editorial decision guidance classification', () => {
  it.each([
    '다낭 가볼만한곳을 고를 때 가장 중요한 기준은 자신의 시간과 체력입니다.',
    '다낭에서 어디를 갈지는 이동 시간과 동행자의 체력, 그리고 탐험 방식에 따라 달라져야 합니다.',
    '먼저 자신의 여행 스타일을 정한 뒤 장소를 고르는 것이 더 현실적입니다.',
    '바나힐을 일정에 넣는다면 이동을 감당할 수 있는가가 핵심입니다.',
    '자세한 다낭 여행 정보는 다낭 여행 가이드에서 확인할 수 있습니다.',
  ])('does not promote reader guidance to an evidence claim: %s', (sentence) => {
    expect(classifyBlogInformationStatement(sentence)).toMatchObject({
      category: 'navigation_boilerplate',
      factualClassification: null,
    });
  });

  it('keeps an unsupported destination fact inside the factual gate', () => {
    expect(classifyBlogInformationStatement('다낭은 우기와 건기가 뚜렷한 지역입니다.'))
      .toMatchObject({ category: 'unknown_unclassified' });
  });

  it('does not let reader-guidance wording hide a measurable claim', () => {
    expect(classifyBlogInformationStatement('먼저 오행산이 도심에서 15분 거리인지 확인하세요.'))
      .toMatchObject({
        category: 'verified_factual',
        factualClassification: { claimType: 'duration' },
      });
  });

  it('treats a source-neutral direct decision answer as editorial guidance', () => {
    expect(classifyBlogInformationStatement(
      '다낭에서 어디를 갈지는 내 일정의 이동 시간과 체력 여유를 먼저 확인한 뒤, 공식 정보에 나온 거리와 위치를 내 우선순위와 비교해 결정하면 됩니다.',
    )).toMatchObject({
      category: 'navigation_boilerplate',
      factualClassification: null,
    });
  });

  it('does not misclassify source-neutral decision instructions as policy requirements', () => {
    expect(classifyBlogInformationStatement(
      '다낭에서 갈 곳을 고를 때는 공식 정보에 나온 위치와 이동 시간을 내 일정의 체력·동선과 직접 비교해야 합니다.',
    )).toMatchObject({
      category: 'navigation_boilerplate',
      factualClassification: null,
    });
  });

  it('keeps a source-neutral route-choice explanation out of the factual ledger', () => {
    expect(classifyBlogInformationStatement(
      '같은 반나절이라도 도시에서 가까운 곳과 서쪽으로 이동해야 하는 곳은 선택 기준이 달라지므로, 내 우선순위에 따라 하나씩 확인하는 방식이 가장 명확합니다.',
    )).toMatchObject({
      category: 'navigation_boilerplate',
      factualClassification: null,
    });
  });

  it.each([
    '일정을 짤 때는 날짜부터 정하기보다 이동 구간을 먼저 나누고, 예약과 휴식 순서를 그 위에 얹는 편이 무리가 적습니다.',
    '동선은 시작에서 가까운 구간을 처리하고, 중간에 휴식 지점을 두며, 마무리에는 우천이나 휴무로 밀릴 수 있는 대체 일정을 남겨 두는 순서로 잡으면 결정이 단순해집니다.',
    '이 순서를 기준으로 예약 확정 여부와 휴식 지점을 다시 점검하면, 이동 부담을 줄이는 일정을 더 쉽게 고를 수 있습니다.',
    '마지막 순서는 공식 채널을 다시 확인해 변동 가능성을 줄이고, 우천이나 휴무에 대비한 대체 일정을 남겨 두는 쪽으로 잡으세요.',
    '마지막 순서는 우천이나 휴무 가능성까지 고려해 대체 일정을 남겨두는 방식으로 결정하세요.',
    '출발 전에 공식 채널에서 운영 여부와 예약 조건을 다시 확인하고, 당일 일정이 어긋날 경우를 대비한 대체 동선을 정해 두세요.',
    '동선은 예약 가능 여부와 휴식 지점을 다시 확인한 뒤에 확정해야 하며, 비나 일정 지연이 생기면 돌아갈 대체안을 미리 정해 두는 편이 낫다.',
    '예약과 휴식을 반영한 실행 순서',
    '시작: 이동 시간이 같은 후보라도 내 숙소에서 실제로 가까운 순서가 아니라, 예약을 먼저 확인할 수 있는 곳부터 배치하세요.',
    '공식 이동 시간을 비교했으면 예약 가능 여부와 운영 공지를 다시 확인하고, 내 출발 지점과 휴식 시간을 기준으로 순서를 확정하세요.',
    '다낭 여행 일정과 이동 동선을 계획할 때 필요한 확인 순서를 정리했습니다.',
    '시작: Linh Ung Pagoda, Bà Nà Hills, Marble Mountains 중 먼저 갈 후보의 예약 가능 여부와 최신 운영 공지를 확인하세요.',
    '공식 이동 시간을 다시 읽고, 내 출발 위치와 예약 시각, 휴식 필요량을 함께 따져보세요.',
    '일정을 짤 때는 먼저 공식 이동 시간을 나란히 놓고 내 출발 지점과 체력에 맞는 순서를 고르는 것이 안전합니다.',
    '무리가 없는 일정은 한 번에 모든 곳을 담기보다, 중간에 쉴 지점과 우천·휴무 대체안을 함께 두는 쪽에서 나옵니다.',
    '동선은 거리만으로 판단하지 말고, 확인된 이동 시간과 휴식 여유를 함께 저울질해야 무리가 없습니다.',
    '어느 구간이 일정에 부담이 될지는 독자의 숙소 위치와 이동 속도에 따라 달라지므로, 숫자를 그대로 확인한 뒤 직접 판단하는 것이 안전합니다.',
  ])('keeps source-neutral itinerary planning advice out of the factual ledger: %s', (sentence) => {
    expect(classifyBlogInformationStatement(sentence)).toMatchObject({
      category: 'navigation_boilerplate',
      factualClassification: null,
    });
  });

  it.each([
    ['바나힐은 이동 시간이 길어 별도 일정으로 분리하는 편이 안전합니다.', 'unknown_unclassified'],
    ['마블 마운틴은 다낭 도심 서쪽에 있어 먼저 일정에서 분리해야 합니다.', 'verified_factual'],
    ['일정을 짤 때는 이동 시간이 긴 곳과 짧은 곳을 나누어 묶고, 예약이 필요한 일정을 먼저 확정한 뒤 나머지를 채우는 순서로 결정하세요.', 'unknown_unclassified'],
    ['동선은 린 응 파고다와 마블마운틴처럼 짧은 이동 구간을 한 흐름으로 두고, 바나힐은 별도 시간대로 분리해 일정 전체의 피로를 줄이는 방향이 무리가 없습니다.', 'unknown_unclassified'],
    ['바나힐은 이동 시간이 길어 다른 일정과 섞으면 동선이 복잡해질 수 있으니, 하루 중 한 블록으로 따로 두는 편이 낫습니다.', 'unknown_unclassified'],
    ['마무리: Bà Nà Hills처럼 이동이 분리되는 일정은 마지막 순서로 두되, 날씨나 휴무로 일정이 어긋날 때 바꿀 대체 동선을 미리 정해 두세요.', 'verified_factual'],
    ['짧은 이동 구간부터 묶어 동선을 단순하게 만들기', 'unknown_unclassified'],
    ['차량 이동 시간이 짧은 두 곳을 먼저 비교하면 일정의 중심축을 잡기 쉽습니다.', 'unknown_unclassified'],
    ['이동 시간이 긴 일정은 별도로 분리해 여유 확보하기', 'unknown_unclassified'],
    ['확인된 공식 정보를 바탕으로 함께 묶을 동선과 따로 둘 일정을 나눕니다.', 'unknown_unclassified'],
  ] as const)('does not let itinerary wording hide a destination assertion: %s', (sentence, category) => {
    expect(classifyBlogInformationStatement(sentence).category).toBe(category);
  });

  it('still blocks a destination fact that merely mentions an itinerary choice', () => {
    expect(classifyBlogInformationStatement(
      '마블 마운틴은 다낭 도심 서쪽에 있어 일정에 따라 선택해야 합니다.',
    )).toMatchObject({
      category: 'verified_factual',
      factualClassification: { candidateKind: 'requirement_prohibition' },
    });
  });

  it.each([
    ['바나힐은 오늘 휴무입니다.', 'time_schedule'],
    ['해당 호텔은 현재 예약 가능합니다.', 'availability_status'],
    ['린 응 파고다는 시내에서 차량으로 15분 소요됩니다.', 'time_schedule'],
    ['관광 비자는 입국 전에 반드시 필요합니다.', 'regulated_policy'],
    ['일정에 여권 사본을 반드시 준비하세요.', 'requirement_prohibition'],
  ] as const)('keeps operational, measurable, and regulated facts inside the evidence gate: %s', (sentence, candidateKind) => {
    expect(classifyBlogInformationStatement(sentence)).toMatchObject({
      category: 'verified_factual',
      factualClassification: { candidateKind },
    });
  });
});

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
  it('validates the production itinerary rewrite with only its three ledgered facts', () => {
    const factualClaims = [
      '다낭 시내에서 Linh Ung Pagoda까지 차량으로 15분 소요',
      '다낭 시내에서 Marble Mountains까지 차량으로 15분 소요',
      '다낭에서 Bà Nà Hills까지 차량으로 40분 소요',
    ];
    const markdown = [
      '일정을 짤 때는 날짜부터 정하기보다 이동 구간을 먼저 나누고, 예약과 휴식 순서를 그 위에 얹는 편이 무리가 적습니다.',
      factualClaims[0],
      factualClaims[1],
      factualClaims[2],
      '동선은 시작에서 가까운 구간을 처리하고, 중간에 휴식 지점을 두며, 마무리에는 우천이나 휴무로 밀릴 수 있는 대체 일정을 남겨 두는 순서로 잡으면 결정이 단순해집니다.',
      '마무리에는 공식 채널을 다시 확인하고, 날씨나 휴무로 일정이 어긋날 때 바꿀 대체 동선을 미리 정해 두세요.',
      '이 순서를 기준으로 예약 확정 여부와 휴식 지점을 다시 점검하면, 이동 부담을 줄이는 일정을 더 쉽게 고를 수 있습니다.',
    ].join('\n\n');
    const claimLedger = factualClaims.flatMap(ledgerFor);

    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: factualClaims.map((claim) => supportedRecord(claim)),
      claimLedger,
      now: NOW,
    });

    expect(report.passed).toBe(true);
    expect(report.coverage).toBe(1);
    expect(report.claims.map((claim) => claim.claimText)).toEqual(factualClaims);
    expect(report.issues).toEqual([]);
  });

  it('validates title, safe description and final-rewrite planning advice without inventing claims', () => {
    const factualClaims = [
      '다낭 시내에서 Linh Ung Pagoda까지 차량으로 15분 소요',
      '다낭에서 Bà Nà Hills까지 차량으로 40분 소요',
      '다낭 시내에서 Marble Mountains까지 차량으로 15분 소요',
    ];
    const publicSurface = [
      '다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      '다낭 여행 일정과 이동 동선을 계획할 때 필요한 확인 순서를 정리했습니다. 본문에 연결된 공식 근거를 먼저 확인하고, 출발 지점·예약·휴식 조건에 맞춰 실행 순서를 정하는 방법을 살펴보세요.',
      '동선은 예약 가능 여부와 휴식 지점을 다시 확인한 뒤에 확정해야 하며, 비나 일정 지연이 생기면 돌아갈 대체안을 미리 정해 두는 편이 낫다.',
      '예약과 휴식을 반영한 실행 순서',
      '시작: 이동 시간이 같은 후보라도 내 숙소에서 실제로 가까운 순서가 아니라, 예약을 먼저 확인할 수 있는 곳부터 배치하세요.',
      '공식 이동 시간을 비교했으면 예약 가능 여부와 운영 공지를 다시 확인하고, 내 출발 지점과 휴식 시간을 기준으로 순서를 확정하세요.',
      ...factualClaims,
    ].join('\n\n');

    const report = validateBlogInformationClaims({
      markdown: publicSurface,
      persistedClaims: factualClaims.map((claim) => supportedRecord(claim)),
      claimLedger: factualClaims.flatMap(ledgerFor),
      now: NOW,
    });

    expect(report.passed).toBe(true);
    expect(report.coverage).toBe(1);
    expect(report.claims.map((claim) => claim.claimText)).toEqual(factualClaims);
    expect(report.issues).toEqual([]);
  });

  it('treats source-neutral food-budget selection guidance as editorial prose', () => {
    const report = validateBlogInformationClaims({
      markdown: [
        '괌 여행 식비 예산에 필요한 비용을 여행 방식별로 나누어 비교합니다.',
        '예산에 포함할 항목을 고르고 나면 하루 식비 총액을 정할 수 있습니다.',
        '이 예산은 확인일 기준으로 수집된 특정 메뉴와 외식 물가 항목만 포함합니다.',
        '위 가격들은 특정 메뉴와 특정 외식 항목에 한정됩니다.',
      ].join('\n\n'),
      persistedClaims: [],
      claimLedger: [],
      now: NOW,
    });

    expect(report.passed).toBe(true);
    expect(report.claims).toEqual([]);
    expect(report.issues).toEqual([]);
  });

  it('does not treat a numeric food-budget assertion as editorial guidance', () => {
    const report = validateBlogInformationClaims({
      markdown: '괌 여행 식비 예산은 하루 80 USD로 정하면 됩니다.',
      persistedClaims: [],
      claimLedger: [],
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'unclassified_factual_candidate',
    }));
  });

  it('blocks the legacy metadata description that asserted unsupported route grouping', () => {
    const report = validateBlogInformationClaims({
      markdown: '확인된 공식 정보를 바탕으로 함께 묶을 동선과 따로 둘 일정을 나눕니다.',
      persistedClaims: [],
      claimLedger: [],
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'unclassified_factual_candidate',
    }));
  });

  it('uses the persisted structured value for an exact approved translated claim', () => {
    const markdown = '미케 해변은 손짜 반도 남쪽에 위치해 있습니다.';
    const record = supportedRecord(markdown, {
      excerpt: '2026년 일본 오사카 KR 대상 My Khe Beach is south of Son Tra Peninsula',
    });
    record.extractedValue = {
      normalizedValue: 'My Khe Beach is south of Son Tra Peninsula',
      unit: null,
      currency: null,
    };
    record.evidence[0]!.scope.normalizedValue = 'My Khe Beach is south of Son Tra Peninsula';

    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [record],
      claimLedger: ledgerFor(markdown),
      now: NOW,
    });

    expect(report.passed).toBe(true);
  });

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
    '일정을 짤 때는 거리보다 휴식 순서를 먼저 정하세요.',
    '선택한 장소의 예약 가능 여부를 공식 채널에서 확인하세요.',
    '이 두 곳을 같은 날에 둘지, 날짜를 나눌지는 예약 가능 시간과 체력에 맞춰 결정하세요.',
  ])('allows clearly non-factual editorial or navigation text: %s', (markdown) => {
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [],
      claimLedger: [],
      now: NOW,
    });

    expect(report.issues).toEqual([]);
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

  it('does not turn an itinerary duration, proposal, or contingency heading into an external fact', () => {
    const editorialOnly = [
      '다낭 3박4일 여행 코스와 이동 동선: 장소별 실행 순서와 대체 동선',
      '다낭 3박4일 여행 코스와 이동 동선의 장소별 실행 순서와 이동 근거를 정리했습니다.',
      '3박4일 일정은 공식 이동 시간을 먼저 확인한 뒤, 하루에 묶을 장소를 독자가 직접 비교해 결정하세요.',
      '아래 제안 일정은 린 응 파고다, 바나힐, 마블 마운틴, 논느억, 호이안을 날짜별로 배치한 하나의 동선 예시입니다.',
      '3일차에는 마블 마운틴을 먼저 두고 논느억 방향으로 이어가는 순서를 제안합니다.',
      '4일차에는 논느억에서 호이안으로 이동하는 흐름을 마지막 일정으로 제안합니다.',
      '우천·휴무·피로 대체 동선',
      '우천·휴무·피로 시 대체 동선',
      '다낭 3박4일 여행 코스와 이동 동선 글 모아보기',
    ].join('\n');

    expect(extractBlogInformationClaims(editorialOnly)).toEqual([]);
  });

  it('keeps a day-numbered contingency edit editorial without hiding a real closure fact', () => {
    const editorial = '우천이나 휴무로 3일차 일정이 어려우면 해당 블록을 빼고 4일차 일정을 앞당기거나 제외하는 안을 먼저 검토하세요.';
    expect(classifyBlogInformationStatement(editorial)).toMatchObject({
      category: 'navigation_boilerplate',
      factualClassification: null,
    });
    expect(extractBlogInformationClaims(editorial)).toEqual([]);

    expect(classifyBlogInformationStatement('오늘 3일차 Marble Mountains는 휴무입니다.')).toMatchObject({
      category: 'verified_factual',
      factualClassification: { candidateKind: 'time_schedule' },
    });
  });

  it('still validates facts placed inside an itinerary proposal', () => {
    expect(extractBlogInformationClaims(
      '3일차에는 마블 마운틴까지 차량으로 15분이 걸리는 동선을 제안합니다.',
    )).toEqual([
      expect.objectContaining({ candidateKind: 'time_schedule' }),
    ]);
  });

  it('extracts only the six declared facts from the production 3-night 4-day rewrite shape', () => {
    const markdown = [
      '# 다낭 3박4일 여행 코스와 이동 동선: 장소별 실행 순서와 대체 동선',
      '다낭 3박4일 여행 코스와 이동 동선의 장소별 실행 순서와 이동 근거를 정리했습니다.',
      '3박4일 일정은 공식 이동 시간을 먼저 확인한 뒤, 하루에 묶을 장소를 독자가 직접 비교해 결정하세요.',
      '아래 제안 일정은 린 응 파고다, 바나힐, 마블 마운틴, 논느억, 호이안을 날짜별로 배치한 하나의 동선 예시입니다.',
      '## 1일차: 린 응 파고다와 바나힐을 후보로 비교하기',
      '린 응 파고다까지 차량으로 15분 소요',
      '바나힐은 다낭에서 서쪽으로 차량 40분 거리',
      '## 2일차: 바나힐 운영 시간에 맞춘 일정 확정하기',
      '선월드 바나힐 운영시간은 오전 8시부터 오후 10시',
      '## 3일차: 마블 마운틴과 논느억을 잇는 일정 제안하기',
      '3일차에는 마블 마운틴을 먼저 두고 논느억 방향으로 이어가는 순서를 제안합니다.',
      '마블 마운틴은 다낭 시내에서 15분 거리',
      '마블 마운틴 투이선 입장료는 성인 40,000 VND',
      '## 4일차: 논느억에서 호이안으로 이동하는 마무리 동선',
      '4일차에는 논느억에서 호이안으로 이동하는 흐름을 마지막 일정으로 제안합니다.',
      '논느억에서 호이안까지 차량으로 30분 소요',
      '## 우천·휴무·피로 대체 동선',
      '[다낭 3박4일 여행 코스와 이동 동선 글 모아보기](https://www.yeosonam.com/blog/destination/%EB%8B%A4%EB%82%AD)',
    ].join('\n\n');

    expect(extractBlogInformationClaims(markdown).map((claim) => claim.claimText)).toEqual([
      '린 응 파고다까지 차량으로 15분 소요',
      '바나힐은 다낭에서 서쪽으로 차량 40분 거리',
      '선월드 바나힐 운영시간은 오전 8시부터 오후 10시',
      '마블 마운틴은 다낭 시내에서 15분 거리',
      '마블 마운틴 투이선 입장료는 성인 40,000 VND',
      '논느억에서 호이안까지 차량으로 30분 소요',
    ]);
  });

  it('keeps production itinerary decisions editorial while retaining measurable facts', () => {
    const markdown = [
      '3박4일 일정은 공식 이동 시간을 먼저 비교한 뒤, 하루에 묶을 장소를 정하고 마지막으로 예약·운영 확인 순서를 잡는 방식으로 구성하세요.',
      '동선은 린 응 파고다, 마블 마운틴, 논느억, 호이안, 바나힐을 기준으로 제안합니다.',
      '아래 일정은 편집 제안이며 공식 노선이 아니므로, 출발 지점과 이동 속도에 따라 직접 판단해야 합니다.',
      '두 장소의 공식 이동 시간을 나란히 놓고, 숙소 위치와 당일 컨디션에 맞는 순서를 고르면 됩니다.',
      '이 순서는 아래 공식 이동 시간을 근거로 한 편집 제안이며, 실제 출발 지점에 따라 달라질 수 있습니다.',
      '아래 운영 시간을 확인한 뒤, 입장 시각과 체류 순서를 정하면 됩니다.',
      '## 4일차: 우천·휴무·피로 대체안과 휴식 결정',
      '4일차는 앞선 일정 중 날씨나 휴무로 빠진 장소를 다시 넣거나, 휴식을 우선할지 결정하세요.',
      '1일차 후보였던 린 응 파고다나 마블 마운틴 중 미방문 장소를 4일차 대체 블록으로 삼을 수 있습니다.',
      '가장 먼저 확인할 블록은 3일차 바나힐입니다.',
      '선월드 바나힐 운영시간은 오전 8시부터 오후 10시',
    ].join('\n\n');

    expect(extractBlogInformationClaims(markdown).map((claim) => claim.claimText)).toEqual([
      '선월드 바나힐 운영시간은 오전 8시부터 오후 10시',
    ]);
  });

  it('does not let itinerary guidance hide a measurable claim', () => {
    expect(extractBlogInformationClaims(
      '3일차에는 바나힐까지 차량으로 40분 이동하는 순서를 제안합니다.',
    )).toEqual([
      expect.objectContaining({ claimType: 'duration', candidateKind: 'time_schedule' }),
    ]);
  });

  it('keeps non-numeric reading guidance editorial but validates prescriptive timing', () => {
    const guidance = [
      '낮과 밤 기온, 비 예보, 일교차를 먼저 봐야 옷차림 실수를 줄일 수 있습니다.',
      '처음 읽는 분은 표와 체크리스트를 먼저 보고, 세부 설명은 필요한 부분만 골라 읽으면 됩니다.',
      '먼저 3줄 요약을 보고, 표에서 비용과 이동 시간을 확인한 뒤, 마지막 체크리스트만 저장해도 됩니다.',
      '숫자는 확정값이 아니라 비교 기준입니다.',
      '출발 7일 전과 24시간 전에는 공식 안내와 예약 조건을 다시 확인하세요.',
    ].join('\n');

    expect(extractBlogInformationClaims(guidance)).toEqual([
      expect.objectContaining({
        claimText: '출발 7일 전과 24시간 전에는 공식 안내와 예약 조건을 다시 확인하세요.',
        candidateKind: 'time_schedule',
      }),
    ]);
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

  it('validates a deterministic local-transport article from its typed approved ledger', () => {
    const priceClaim = 'Roam Transit 8X 성인 요금은 12.50 CAD입니다.';
    const policyClaim = '모레인 호수 도로는 개인 차량 통행이 금지됩니다.';
    const persistedClaims = [
      supportedRecord(priceClaim, {
        excerpt: `2026년 캐나다 로키산맥 KR 대상: ${priceClaim}`,
        scope: {
          country: '캐나다',
          destination: '캐나다 로키산맥',
          currency: 'CAD',
        },
      }),
      supportedRecord(policyClaim, {
        excerpt: `2026년 캐나다 로키산맥 KR 대상: ${policyClaim}`,
        scope: { country: '캐나다', destination: '캐나다 로키산맥' },
      }),
    ];
    persistedClaims[0]!.extractedValue!.currency = 'CAD';
    persistedClaims[0]!.evidence[0]!.scope.currency = 'CAD';
    persistedClaims[1]!.claimType = 'policy';
    persistedClaims[1]!.evidence[0]!.claimType = 'policy';
    persistedClaims[1]!.evidence[0]!.scope.claimType = 'policy';
    const ledger: BlogInformationClaimLedgerEntry[] = [
      {
        ...ledgerFor(priceClaim)[0]!,
        riskLevel: 'MEDIUM',
      },
      {
        ...ledgerFor(policyClaim)[0]!,
        claimType: 'policy',
        riskLevel: 'HIGH',
      },
    ];
    const markdown = [
      '<!-- blog_research_structure:local_transport:v1 -->',
      '# 캐나다 로키산맥 대중교통',
      '',
      '공식 운영사의 표부터 비교해 보세요.',
      '',
      '| 노선 | 요금 | 예약 |',
      '| --- | ---: | --- |',
      '| 8X | 12.50 CAD | 사전 확인 |',
      '<!-- /blog_research_structure:local_transport:v1 -->',
    ].join('\n');
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims,
      claimLedger: ledger,
      intentType: 'local_transport',
      reviewStatus: 'approved',
      expectedScope: {
        country: '캐나다',
        destination: '캐나다 로키산맥',
      },
      now: NOW,
    });

    expect(report.issues).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.coverage).toBe(1);
    expect(report.requiresHumanReview).toBe(true);
    expect(report.claims).toEqual([
      expect.objectContaining({ claimText: priceClaim, claimType: 'price' }),
      expect.objectContaining({ claimText: policyClaim, claimType: 'policy' }),
    ]);
  });

  it('validates the code-owned airport route article even when SEO metadata precedes its marker', () => {
    const claimText = '괌 관광청은 표준 택시 미터 요금을 기본 호출 2.40 USD로 안내합니다.';
    const persisted = supportedRecord(claimText, {
      excerpt: `2026년 괌 KR 대상 택시 공식 요금: ${claimText}`,
      scope: { country: '괌', destination: '괌', applicableTo: 'KR', currency: 'USD' },
    });
    persisted.extractedValue!.currency = 'USD';
    persisted.evidence[0]!.scope.currency = 'USD';
    const ledger = ledgerFor(claimText);
    ledger[0]!.riskLevel = 'MEDIUM';
    const markdown = [
      '괌 공항 교통 공식 근거 안내',
      '',
      '<!-- blog_decision_artifact:route_decision:v1 -->',
      '# 괌 공항 투몬 교통',
      '',
      claimText,
      '',
      '<!-- /blog_decision_artifact:route_decision:v1 -->',
    ].join('\n');
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [persisted],
      claimLedger: ledger,
      intentType: 'airport_transport',
      now: NOW,
    });

    expect(report.issues).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.coverage).toBe(1);
  });

  it('fails closed when the writer ledger downgrades deterministic price risk', () => {
    const claimText = '미선 유적지 입장료는 국제 방문객 기준 150,000 VND입니다.';
    const ledger = ledgerFor(claimText);
    ledger[0]!.riskLevel = 'LOW';
    const report = validateBlogInformationClaims({
      markdown: claimText,
      persistedClaims: [supportedRecord(claimText, {
        scope: { currency: 'VND' },
      })],
      claimLedger: ledger,
      now: NOW,
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'invalid_claim_ledger',
        message: expect.stringContaining('LOW->MEDIUM'),
      }),
    ]));
  });

  it('validates only approved ledger claims in a deterministic entry article', () => {
    const claimText = '비자 면제 프로그램 여행자는 승인된 ESTA를 받아야 합니다.';
    const persisted = supportedRecord(claimText, {
      excerpt: `2026 미국 모든 여행자 ESTA 필요 ${claimText}`,
      scope: { country: '미국', destination: '미국', applicableTo: '모든 여행자' },
    });
    persisted.claimType = 'entry_visa';
    persisted.evidence[0]!.claimType = 'entry_visa';
    persisted.evidence[0]!.scope.claimType = 'entry_visa';
    const ledger = ledgerFor(claimText);
    ledger[0]!.claimType = 'entry_visa';
    ledger[0]!.riskLevel = 'HIGH';
    const markdown = [
      '<!-- blog_research_structure:entry_requirements:v1 -->',
      '# 미국 입국 요건',
      '',
      '검색 요약이 아니라 공식 원문을 확인하는 순서로 읽으세요.',
      '',
      `- ${claimText}`,
      '<!-- /blog_research_structure:entry_requirements:v1 -->',
    ].join('\n');
    const report = validateBlogInformationClaims({
      markdown,
      persistedClaims: [persisted],
      claimLedger: ledger,
      intentType: 'entry_requirements',
      reviewStatus: 'approved',
      expectedScope: { destination: '미국' },
      now: NOW,
    });

    expect(report.issues).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.coverage).toBe(1);
    expect(report.claims).toEqual([
      expect.objectContaining({ claimText, claimType: 'entry_visa' }),
    ]);
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

  it('requires both official evidence components for a split monthly climate claim', () => {
    const claimText =
      '1991~2020 평년값: 1월 최고기온 11.7°C, 최저기온 2.1°C, 강수량 79.6mm, 강수일수 5.3일';
    const record = supportedRecord(claimText);
    record.extractedValue = {
      normalizedValue: '11.7|2.1|79.6|5.3',
      unit: '월별 기후 지표',
      currency: null,
    };
    record.evidence = [
      {
        ...record.evidence[0]!,
        evidenceKey: 'jma-temperature',
        excerpt: '2026년 일본 오사카 KR 대상: 1991~2020 평년값 1월 최고기온 11.7°C, 최저기온 2.1°C; 값=11.7|2.1; 단위=월별 기온 지표',
        scope: {
          ...record.evidence[0]!.scope,
          normalizedValue: '11.7|2.1',
          unit: '월별 기온 지표',
        },
      },
      {
        ...record.evidence[0]!,
        evidenceKey: 'jma-precipitation',
        excerpt: '2026년 일본 오사카 KR 대상: 1991~2020 평년값 1월 강수량 79.6mm, 강수일수 5.3일; 값=79.6|5.3; 단위=월별 강수 지표',
        scope: {
          ...record.evidence[0]!.scope,
          normalizedValue: '79.6|5.3',
          unit: '월별 강수 지표',
        },
      },
    ];

    const complete = validateBlogInformationClaims({
      markdown: claimText,
      persistedClaims: [record],
      claimLedger: ledgerFor(claimText),
      now: NOW,
    });
    const incomplete = validateBlogInformationClaims({
      markdown: claimText,
      persistedClaims: [{ ...record, evidence: record.evidence.slice(0, 1) }],
      claimLedger: ledgerFor(claimText),
      now: NOW,
    });

    expect(complete.passed).toBe(true);
    expect(incomplete.passed).toBe(false);
    expect(incomplete.issues).toEqual([
      expect.objectContaining({
        code: 'evidence_semantic_mismatch',
        message: expect.stringContaining('composite_evidence_missing:monthly_precipitation'),
      }),
    ]);
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
