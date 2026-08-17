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
      itineraryEvidenceTexts: [
        'Marble Mountains에서 Linh Ung Pagoda까지 차량으로 15분 걸립니다.',
        '다낭 시내에서 Bà Nà Hills까지 차량으로 40분 걸립니다.',
      ],
      intentCompletionScore: 1,
      serpIntentAlignment: 1,
      decisionCompletion: 1,
      sectionPurposeCoverage: 1,
    });

    expect(report.dimensions.intent_completion.passed).toBe(false);
    expect(report.dimensions.decision_completion.passed).toBe(false);
    expect(report.dimensions.section_purpose_coverage.passed).toBe(false);
    expect(report.failureReasons.map((failure) => failure.code)).toContain(
      'concrete_itinerary_blocks_missing',
    );
  });

  it('accepts the intent artifact when an itinerary contains a direct grouping and usable order', () => {
    const body = [
      '# 다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      '다낭 일정은 Marble Mountains와 Linh Ung Pagoda를 오전 제안에 두고, Bà Nà Hills는 오후 제안으로 나눠 동선을 정하세요.',
      '## 오전: Marble Mountains와 Linh Ung Pagoda',
      '공식 사이트에서 예약과 운영 여부를 확인하고, 이동 뒤 식사와 휴식 시간을 남겨 두세요.',
      'Marble Mountains에서 Linh Ung Pagoda까지 차량으로 15분 걸립니다.',
      '## 오후: Bà Nà Hills',
      '비가 오거나 일정이 지연되면 이 블록을 줄이고 실내 대체 일정을 선택하세요.',
      '다낭 시내에서 Bà Nà Hills까지 차량으로 40분 걸립니다.',
    ].join('\n\n');
    const report = evaluateBlogQualityV3({
      ...base,
      title: '다낭 여행 일정과 이동 동선: 이동 부담을 줄이는 순서',
      body,
      destination: '다낭',
      primaryQuery: '다낭 여행 일정과 이동 동선',
      primaryDecision: '언제 무엇을 해야 무리가 없는가?',
      archetype: 'itinerary_timeline',
      itineraryEvidenceTexts: [
        'Marble Mountains에서 Linh Ung Pagoda까지 차량으로 15분 걸립니다.',
        '다낭 시내에서 Bà Nà Hills까지 차량으로 40분 걸립니다.',
      ],
      intentCompletionScore: 1,
      serpIntentAlignment: 1,
      decisionCompletion: 1,
      sectionPurposeCoverage: 1,
    });

    expect(report.dimensions.intent_completion).toMatchObject({ value: 1, passed: true });
    expect(report.dimensions.decision_completion.passed).toBe(true);
    expect(report.dimensions.section_purpose_coverage.passed).toBe(true);
  });

  it('requires every distinct day ordinal for an explicit 3-night 4-day itinerary', () => {
    const evidence = [
      'Marble Mountains에서 Linh Ung Pagoda까지 차량으로 15분 걸립니다.',
      '다낭 시내에서 Bà Nà Hills까지 차량으로 40분 걸립니다.',
      'Son Tra Peninsula는 계절별 출입 조건이 있습니다.',
      'Hoi An까지 차량 이동에는 30분이 걸립니다.',
    ];
    const common = {
      ...base,
      title: '다낭 3박4일 여행 코스와 이동 동선',
      destination: '다낭',
      primaryQuery: '다낭 3박4일 여행 코스와 이동 동선',
      primaryDecision: '3박4일 동안 어느 날에 어느 장소를 배치해야 하는가?',
      archetype: 'itinerary_timeline',
      itineraryEvidenceTexts: evidence,
      intentCompletionScore: 1,
      serpIntentAlignment: 1,
      decisionCompletion: 1,
      sectionPurposeCoverage: 1,
    };
    const shared = [
      '# 다낭 3박4일 여행 코스와 이동 동선',
      '다낭 일정은 Marble Mountains부터 Bà Nà Hills, Son Tra Peninsula, Hoi An 순으로 나눈 제안 동선입니다.',
      '공식 사이트에서 예약과 출입 조건을 확인하고 식사와 휴식을 남겨 두세요.',
      'Marble Mountains에서 Linh Ung Pagoda까지 차량으로 15분 걸립니다.',
      '비가 오거나 일정이 지연되면 Hoi An 블록을 대체 일정으로 바꾸세요.',
    ];
    const repeatedFirstDay = evaluateBlogQualityV3({
      ...common,
      body: [...shared,
        '## 1일차: Marble Mountains',
        '## 1일차: Bà Nà Hills',
        '## 1일차: Son Tra Peninsula',
        '## 1일차: Hoi An',
      ].join('\n\n'),
    });
    const complete = evaluateBlogQualityV3({
      ...common,
      body: [...shared,
        '## 1일차: Marble Mountains',
        '## 2일차: Bà Nà Hills',
        '## 3일차: Son Tra Peninsula',
        '## 4일차: Hoi An',
      ].join('\n\n'),
    });
    const combinedAndDuplicated = evaluateBlogQualityV3({
      ...common,
      body: [...shared,
        '## 1일차와 2일차: Marble Mountains와 Bà Nà Hills',
        '## 2일차 대안: Bà Nà Hills',
        '## 3일차: Son Tra Peninsula',
        '## 4일차: Hoi An',
      ].join('\n\n'),
    });

    expect(repeatedFirstDay.failureReasons.map((failure) => failure.code))
      .toContain('concrete_itinerary_blocks_missing');
    expect(combinedAndDuplicated.failureReasons.map((failure) => failure.code))
      .toContain('concrete_itinerary_blocks_missing');
    expect(combinedAndDuplicated.dimensions.intent_completion.evidence)
      .toContain('itinerary_day_h2_contract=false');
    expect(complete.dimensions.intent_completion.passed).toBe(true);
    expect(complete.dimensions.intent_completion.evidence).toContain('itinerary_day_ordinals=1,2,3,4');
    expect(complete.dimensions.intent_completion.evidence).toContain('itinerary_day_h2_contract=true');
  });

  it('recognizes Korean evidence-backed place names without semantic suffixes in day headings', () => {
    const body = [
      '# 다낭 3박4일 여행 코스와 이동 동선',
      '3박4일 일정은 린 응 파고다부터 바나힐, 마블 마운틴, 논느억과 호이안 순으로 나눈 제안 동선입니다.',
      '공식 사이트에서 예약과 운영 여부를 확인하고 식사와 휴식을 남겨 두세요.',
      '린 응 파고다까지 차량으로 15분 소요',
      '비가 오거나 일정이 지연되면 호이안 블록을 대체 일정으로 바꾸세요.',
      '## 1일차: 린 응 파고다와 바나힐',
      '## 2일차: 바나힐 운영 조건 확인',
      '## 3일차: 마블 마운틴과 논느억',
      '## 4일차: 논느억에서 호이안으로 이동',
    ].join('\n\n');
    const report = evaluateBlogQualityV3({
      ...base,
      title: '다낭 3박4일 여행 코스와 이동 동선',
      body,
      destination: '다낭',
      primaryQuery: '다낭 3박4일 여행 코스와 이동 동선',
      primaryDecision: '3박4일 동안 어느 날에 어느 장소를 배치해야 하는가?',
      archetype: 'itinerary_timeline',
      itineraryEvidenceTexts: [
        '린 응 파고다까지 차량으로 15분 소요',
        '바나힐은 다낭에서 서쪽으로 차량 40분 거리',
        '마블 마운틴은 다낭 시내에서 15분 거리',
        '논느억에서 호이안까지 차량으로 30분 소요',
      ],
      intentCompletionScore: 1,
      serpIntentAlignment: 1,
      decisionCompletion: 1,
      sectionPurposeCoverage: 1,
    });

    expect(report.dimensions.intent_completion).toMatchObject({ value: 1, passed: true });
    expect(report.dimensions.intent_completion.evidence).toEqual(expect.arrayContaining([
      'itinerary_day_ordinals=1,2,3,4',
      expect.stringContaining('호이안'),
    ]));
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

  it('does not count a bare mention of traveler stamina as an actual rest decision', () => {
    const body = [
      '# 다낭 3박4일 여행 코스와 이동 동선',
      '공식 이동 시간을 확인한 뒤 출발 지점과 하루 체력에 맞춰 장소 순서를 결정하세요.',
      '## 1일차: 린 응 파고다',
      '린 응 파고다까지 차량으로 15분이 소요됩니다.',
      '## 2일차: 바나힐',
      '바나힐은 다낭에서 서쪽으로 차량으로 40분 거리에 있습니다.',
      '출발 전에 공식 운영 공지를 확인하세요.',
      '## 3일차: 마블 마운틴과 호이안',
      '논느억 지역에서 호이안까지 차량으로 30분이 소요됩니다.',
      '## 4일차: 미선 유적지',
      '우천이나 휴무가 생기면 호이안 블록과 맞바꾸는 대체 동선을 두세요.',
    ].join('\n\n');
    const report = evaluateBlogQualityV3({
      ...base,
      title: '다낭 3박4일 여행 코스와 이동 동선',
      body,
      destination: '다낭',
      primaryQuery: '다낭 3박4일 여행 코스와 이동 동선',
      primaryDecision: '3박4일 동안 어느 날에 어느 장소를 배치해야 하는가?',
      archetype: 'itinerary_timeline',
      itineraryEvidenceTexts: [
        '린 응 파고다까지 차량으로 15분이 소요됩니다.',
        '바나힐은 다낭에서 서쪽으로 차량으로 40분 거리에 있습니다.',
        '논느억 지역에서 호이안까지 차량으로 30분이 소요됩니다.',
        '미선 유적지 입장료는 150,000 VND입니다.',
      ],
      intentCompletionScore: 1,
      serpIntentAlignment: 1,
      decisionCompletion: 1,
      sectionPurposeCoverage: 1,
    });

    expect(report.dimensions.intent_completion.passed).toBe(false);
    expect(report.dimensions.intent_completion.evidence).toContain('rest_plan=false');
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
      '## 오전: Linh Ung Pagoda와 Marble Mountains',
      '후보의 예약 상태와 운영 공지를 확인하세요. 이동 사이에 휴식 지점을 두고 공식 이동 시간을 비교하세요.',
      '## 오후: Bà Nà Hills',
      '우천이나 지연에 쓸 대체 동선을 정하고 예약을 다시 확인하세요.',
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
      itineraryEvidenceTexts: [
        '다낭 시내에서 Linh Ung Pagoda까지 차량으로 15분 소요',
        '다낭 시내에서 Marble Mountains까지 차량으로 15분 소요',
        '다낭에서 Bà Nà Hills까지 차량으로 40분 소요',
      ],
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
