import { describe, expect, it } from 'vitest';
import { evaluateBlogQualityV3 } from './blog-quality-evaluator-v3';

const base = {
  title: '오사카 숙소 위치를 고르는 세 가지 기준',
  body: '오사카 숙소 위치를 고르는 기준입니다. 난바역 도보권은 밤 이동이 짧습니다. 우메다는 교토 이동 환승이 적습니다. 덴노지는 공항 노선 선택지가 다릅니다.',
  destination: '오사카', primaryDecision: '오사카 숙소 위치',
  supportedClaimCount: 3, factualClaimCount: 3, destinationSpecificDetailCount: 3,
  informationGainScore: 0.8, userActionability: 0.8,
};

describe('explainable blog quality evaluator v3', () => {
  it('keeps evidence and failure reason per dimension', () => {
    const report = evaluateBlogQualityV3(base);
    expect(report.dimensions.destination_specificity.evidence).not.toHaveLength(0);
    expect(report.version).toBe('blog-quality-v3');
  });

  it('uses the measured decision-completion score instead of requiring prompt text verbatim', () => {
    const report = evaluateBlogQualityV3({
      ...base,
      primaryDecision: '여행자 유형과 이동 부담에 따라 장소를 고른다',
      intentCompletionScore: 0.9,
    });

    expect(report.dimensions.intent_completion).toMatchObject({
      value: 0.9,
      passed: true,
    });
  });

  it.each([
    '고민을에서 덜어드리겠습니다.에서 엄선한', '여 여소남 에디터', '낮춝니다',
    '어렵편입니다', '여행 준비 여행', '쉥겐 협약국 2-6개국',
  ])('fails broken Korean: %s', (body) => {
    expect(evaluateBlogQualityV3({ ...base, body }).hardBlockers).toContain('korean_language_integrity');
  });

  it('fails unsupported experience and stale ETIAS claims', () => {
    expect(evaluateBlogQualityV3({ ...base, body: '운영팀 검증 결과입니다.' }).hardBlockers).toContain('unsupported_first_party_claim');
    expect(evaluateBlogQualityV3({ ...base, title: 'ETIAS 안내', body: 'ETIAS는 2025년 상반기부터 7유로입니다.' }).hardBlockers).toContain('stale_etias_2025_or_7_euro');
  });

  it('does not confuse an instruction to verify locally with a claimed field verification', () => {
    expect(evaluateBlogQualityV3({ ...base, body: '현지에서 확인이 필요합니다.' }).hardBlockers)
      .not.toContain('unsupported_first_party_claim');
    expect(evaluateBlogQualityV3({ ...base, body: '현지에서 확인했습니다.' }).hardBlockers)
      .toContain('unsupported_first_party_claim');
  });

  it('fails part suffix, generic checklist and destination-swapped weather saturation', () => {
    expect(evaluateBlogQualityV3({ ...base, title: '오사카 숙소 위치 (2편)' }).hardBlockers).toContain('numeric_part_title_suffix');
    expect(evaluateBlogQualityV3({ ...base, body: '이곳 준비물입니다. 이곳 체크리스트입니다. 이곳에서 확인하세요.', destinationSpecificDetailCount: 0 }).passed).toBe(false);
    expect(evaluateBlogQualityV3({ ...base, templateSaturation: true }).hardBlockers).toContain('template_saturation');
  });

  it('rejects an evidence-correct itinerary that never produces an executable sequence', () => {
    const body = [
      '# 다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      '지금 어떤 이동수단을 고를지는 공식 정보의 시간과 수치를 내 일정에 대조해 결정하세요.',
      '## 이동 시간을 기준으로 선택지 좁히기',
      '오행산은 도시에서 차로 15분 거리입니다.',
      '바나힐은 다낭 시내에서 차로 40분 거리입니다.',
      '이 공식 정보가 내 일정과 맞는지 확인하세요.',
      '## 무엇을 결정할까?',
      '- 이 수치를 내 우선순위와 비교하세요.',
      '- 동행자와 함께 이 시간을 확인하세요.',
    ].join('\n\n');
    const report = evaluateBlogQualityV3({
      ...base,
      title: '다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      body,
      destination: '다낭',
      primaryQuery: '다낭 여행 일정과 이동 동선',
      primaryDecision: '언제 무엇을 해야 무리가 없는가?',
      archetype: 'itinerary_timeline',
      intentCompletionScore: 1,
      serpIntentAlignment: 1,
      decisionCompletion: 1,
      sectionPurposeCoverage: 1,
    });

    expect(report.dimensions.intent_completion.passed).toBe(false);
    expect(report.dimensions.decision_completion.passed).toBe(false);
    expect(report.dimensions.section_purpose_coverage.passed).toBe(false);
    expect(report.failureReasons.map((failure) => failure.code)).toEqual(expect.arrayContaining([
      'primary_decision_not_answered',
      'reader_decision_incomplete',
      'section_purpose_missing',
    ]));
  });

  it('accepts the intent artifact when an itinerary contains a direct grouping and usable order', () => {
    const body = [
      '# 다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      '다낭 일정은 오행산과 린응사를 한 동선 후보로 묶고, 바나힐은 별도 순서로 두는 방식이 이동 부담을 비교하기 쉽습니다.',
      '## 추천 동선과 실행 순서',
      '- 먼저 출발점을 정하고 오행산과 린응사를 묶어 비교하세요.',
      '- 이어서 공식 사이트에서 예약과 운영 여부를 확인하고, 식사와 휴식 시간을 남겨 두세요.',
      '- 마지막에는 드래곤 브리지를 검토하되 비가 오거나 일정이 지연되면 실내 대체 일정을 선택하세요.',
      '오행산은 도시에서 차로 15분 거리입니다.',
    ].join('\n\n');
    const report = evaluateBlogQualityV3({
      ...base,
      title: '다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      body,
      destination: '다낭',
      primaryQuery: '다낭 여행 일정과 이동 동선',
      primaryDecision: '언제 무엇을 해야 무리가 없는가?',
      archetype: 'itinerary_timeline',
      intentCompletionScore: 1,
      serpIntentAlignment: 1,
      decisionCompletion: 1,
      sectionPurposeCoverage: 1,
    });

    expect(report.dimensions.intent_completion).toMatchObject({ value: 1, passed: true });
    expect(report.dimensions.decision_completion.passed).toBe(true);
    expect(report.dimensions.section_purpose_coverage.passed).toBe(true);
  });

  it('rejects a short claim list that looks ordered but omits booking, rest, and contingency decisions', () => {
    const body = [
      '# 다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      '린응사와 오행산을 가까운 이동 기준으로 묶고, 바나힐은 별도 후보로 두어 동선을 비교하세요.',
      '## 가까운 거리부터 묶어 비교하세요',
      '- 린응사와 오행산을 묶어 비교하세요.',
      '- 다낭에서 린응사까지 차량으로 15분 소요',
      '## 최종 일정 확정 순서',
      '- 출발 지점을 기록하세요.',
      '- 바나힐을 단독 후보로 분리하세요.',
      '- 마지막 순서로 남기고 최종 동선을 확정하세요.',
    ].join('\n\n');
    const report = evaluateBlogQualityV3({
      ...base,
      title: '다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      body,
      destination: '다낭',
      primaryQuery: '다낭 여행 일정과 이동 동선',
      primaryDecision: '언제 무엇을 해야 무리가 없는가?',
      archetype: 'itinerary_timeline',
      intentCompletionScore: 1,
      serpIntentAlignment: 1,
      decisionCompletion: 1,
      sectionPurposeCoverage: 1,
    });

    expect(report.dimensions.decision_completion.passed).toBe(false);
    expect(report.dimensions.decision_completion.evidence).toEqual(expect.arrayContaining([
      'reservation_check=false',
      'rest_plan=false',
      'fallback_plan=false',
    ]));
    expect(report.passed).toBe(false);
  });

  it('rejects an itinerary that repeats the same planning concepts without adding information', () => {
    const body = [
      '# 다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      '일정을 짤 때는 먼저 공식 이동 시간을 나란히 놓고 내 출발 지점과 체력에 맞는 순서를 고르세요. 예약 상태와 휴식 지점을 다시 확인하고 동선을 결정하세요. 우천이나 일정 지연에 대비한 대체 동선도 미리 정하세요.',
      '## 공식 이동 시간으로 후보 비교하기',
      '다낭 시내에서 린응 파고다까지 차량으로 15분 소요',
      '다낭에서 바나힐까지 차량으로 40분 소요',
      '다낭 시내에서 마블 마운틴까지 차량으로 15분 소요',
      '세 구간의 공식 이동 시간을 내 출발 지점과 비교하세요. 어느 구간을 먼저 둘지는 예약 가능 여부와 휴식 여유를 확인한 뒤 결정하세요.',
      '## 예약과 휴식 순서로 실행하기',
      '- 시작: 후보의 예약 상태와 운영 공지를 확인하세요.',
      '- 중간: 이동 사이에 휴식 지점을 두고 공식 이동 시간을 비교하세요.',
      '- 마무리: 우천이나 지연에 쓸 대체 동선을 정하고 예약을 다시 확인하세요.',
      '공식 이동 시간은 그대로 두고 내 출발 위치와 체력, 예약 조건에 따라 순서를 바꾸세요. 최신 운영 공지를 확인하고 대체안을 남겨 두세요.',
    ].join('\n\n');
    const report = evaluateBlogQualityV3({
      ...base,
      title: '다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      body,
      destination: '다낭',
      primaryQuery: '다낭 여행 일정과 이동 동선',
      primaryDecision: '언제 무엇을 해야 무리가 없는가?',
      archetype: 'itinerary_timeline',
      intentCompletionScore: 1,
      informationGainScore: 1,
      comparativeInformationGain: 1,
      serpIntentAlignment: 1,
      decisionCompletion: 1,
      sectionPurposeCoverage: 1,
    });

    expect(report.dimensions.intent_completion.passed).toBe(true);
    expect(report.dimensions.information_gain).toMatchObject({ value: 0.5, passed: false });
    expect(report.dimensions.comparative_information_gain.passed).toBe(false);
    expect(report.failureReasons.map((failure) => failure.code)).toContain(
      'decision_concepts_repeated_without_new_information',
    );
    expect(report.passed).toBe(false);
  });
});
