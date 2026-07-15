import { describe, expect, it } from 'vitest';
import {
  BLOG_INFORMATION_INTENTS,
  buildBlogInformationContract,
  inferBlogInformationIntent,
  inspectBlogInformationMarkdown,
  validateBlogDestinationEntity,
  type BlogInformationContract,
} from './blog-information-contract';

function markdownCovering(contract: BlogInformationContract, includeTable = false): string {
  const sections = contract.requiredSlots.map((slot) => `## ${slot.label}\n\n검증된 안내입니다.`).join('\n\n');
  if (!includeTable) return sections;
  return `${sections}\n\n| 월 | 최고 | 최저 |\n| --- | --- | --- |\n| 1월 | 5℃ | -2℃ |\n| 6월 | 24℃ | 17℃ |\n| 12월 | 8℃ | 1℃ |`;
}

describe('blog information contract', () => {
  it.each([
    ['food_budget', { destination: 'Tokyo', topic: 'food budget and meal cost' }],
    ['monthly_weather', { destination: 'Sapporo', topic: 'monthly weather climate rainfall' }],
    ['airport_transport', { destination: 'Osaka', topic: 'airport transfer transport' }],
    ['hotel_areas', { destination: 'Bangkok', topic: 'where to stay hotel areas' }],
    ['family_budget', { destination: 'Cebu', topic: 'family trip budget' }],
    ['family_itinerary', { destination: 'Danang', topic: 'family itinerary and route' }],
    ['entry_requirements', { destination: 'Japan', topic: 'visa entry immigration rules' }],
    ['travel_insurance', { topic: 'travel insurance medical evacuation' }],
    ['currency_payment', { destination: 'Taipei', topic: 'currency exchange and payment' }],
    ['general', { destination: 'Paris', topic: 'first trip practical guide' }],
  ] as const)('infers %s', (expected, input) => {
    expect(inferBlogInformationIntent(input)).toBe(expected);
  });

  it('keeps the supported intent list explicit and stable', () => {
    expect(BLOG_INFORMATION_INTENTS).toEqual([
      'food_budget',
      'monthly_weather',
      'airport_transport',
      'hotel_areas',
      'family_budget',
      'family_itinerary',
      'entry_requirements',
      'travel_insurance',
      'currency_payment',
      'general',
    ]);
  });

  it('lets a structured micro angle override stale category metadata', () => {
    expect(inferBlogInformationIntent({
      destination: 'Mongolia',
      topic: 'arrival options',
      category: 'weather',
      microAngle: 'transport_cost',
    })).toBe('airport_transport');
  });

  it('keeps the persisted planner intent stable during final quality inspection', () => {
    expect(inferBlogInformationIntent({
      intentType: 'airport_transport',
      destination: '오사카',
      topic: '오사카 여행 안내',
      category: 'weather',
    })).toBe('airport_transport');
  });

  it.each([
    ['3', 'numeric_destination'],
    ['top', 'reserved_destination'],
    ['대학생', 'audience_destination'],
    ['kualalumpursingaporemalacca', 'machine_concatenated_destination'],
  ] as const)('rejects invalid destination entity %s', (destination, issueCode) => {
    const result = validateBlogDestinationEntity(destination);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(issueCode);
  });

  it('accepts a real destination entity', () => {
    expect(validateBlogDestinationEntity('삿포로')).toEqual({
      valid: true,
      destination: '삿포로',
      issues: [],
    });
  });

  it('blocks destination-dependent intent when destination is absent', () => {
    const contract = buildBlogInformationContract({ topic: 'airport transfer options' });
    expect(contract.intentType).toBe('airport_transport');
    expect(contract.passed).toBe(false);
    expect(contract.issues).toContain('missing_destination_for_intent');
  });

  it('requires primary sources and human review for entry requirements', () => {
    const contract = buildBlogInformationContract({ destination: 'Japan', topic: 'visa entry rules' });
    expect(contract.sourcePolicy).toMatchObject({
      minimumClaimSourceCoverage: 1,
      primarySourcesRequired: true,
      exactNumbersRequireSource: true,
      retrievedAtRequired: true,
    });
    expect(contract.humanReview.required).toBe(true);
    expect(contract.sourceRequirements.join(' ')).toContain('사람 편집자 승인 전');
  });

  it('requires human review for insurance but not ordinary food-budget content', () => {
    const insurance = buildBlogInformationContract({ topic: 'travel insurance coverage' });
    const food = buildBlogInformationContract({ destination: 'Tokyo', topic: 'food budget' });
    expect(insurance.humanReview.required).toBe(true);
    expect(food.humanReview).toEqual({ required: false, reason: null });
  });

  it('requires official climate sources and observation periods for weather', () => {
    const contract = buildBlogInformationContract({ destination: 'Sapporo', topic: 'monthly weather' });
    expect(contract.sourcePolicy.minimumClaimSourceCoverage).toBe(0.9);
    expect(contract.sourcePolicy.primarySourcesRequired).toBe(true);
    expect(contract.sourceRequirements.join(' ')).toContain('관측 기간');
  });

  it('passes markdown only when every required weather slot and a renderable table exist', () => {
    const contract = buildBlogInformationContract({ destination: 'Sapporo', topic: 'monthly weather' });
    const report = inspectBlogInformationMarkdown({
      contract,
      markdown: markdownCovering(contract, true),
    });
    expect(report.passed).toBe(true);
    expect(report.missingSlots).toEqual([]);
    expect(report.coveredSlots).toHaveLength(contract.requiredSlots.length);
  });

  it('reports missing required slots', () => {
    const contract = buildBlogInformationContract({ destination: 'Paris', topic: 'first trip guide' });
    const report = inspectBlogInformationMarkdown({
      contract,
      markdown: '## 검색 질문에 대한 직접 답\n\n핵심 답입니다.',
    });
    expect(report.passed).toBe(false);
    expect(report.missingSlots).toEqual(expect.arrayContaining([
      'decision_criteria',
      'practical_checklist',
      'risks',
    ]));
    expect(report.issues.some((issue) => issue.code === 'missing_required_slot')).toBe(true);
  });

  it('detects internal product and reservation operational data leaks', () => {
    const contract = buildBlogInformationContract({ destination: 'Paris', topic: 'first trip guide' });
    const report = inspectBlogInformationMarkdown({
      contract,
      markdown: `${markdownCovering(contract)}\n\n활성 상품 0개, 최근 예약 신호 0건, booking_count=0`,
    });
    expect(report.passed).toBe(false);
    expect(report.operationalDataLeaks).toEqual(expect.arrayContaining([
      '활성 상품 0개',
      '최근 예약 신호 0건',
      'booking_count',
    ]));
    expect(report.issues.some((issue) => issue.code === 'internal_operational_data_leak')).toBe(true);
  });
});
