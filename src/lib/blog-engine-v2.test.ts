import { describe, expect, it } from 'vitest';
import { buildBlogEngineV2Brief, evaluateBlogEngineV2 } from './blog-engine-v2';

describe('blog engine v2 evaluation', () => {
  it('never treats stock-photo image links or arbitrary websites as official evidence', () => {
    const brief = buildBlogEngineV2Brief({
      blogHtml: [
        '![삿포로 겨울 풍경](https://images.pexels.com/photos/123/photo.jpeg)',
        '[일반 여행 블로그](https://example.com/sapporo-weather)',
      ].join('\n\n'),
      primaryKeyword: '삿포로 월별 날씨',
      destination: '삿포로',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
      },
    });

    expect(brief.evidence_items.filter((item) => item.kind === 'official_source')).toEqual([]);
  });

  it('keeps conservative government links as official-source candidates', () => {
    const brief = buildBlogEngineV2Brief({
      blogHtml: '[인도네시아 외교부](https://kemlu.go.id)',
      generationMeta: { writer: 'info_writer' },
    });

    expect(brief.evidence_items).toEqual([
      expect.objectContaining({ kind: 'official_source', url: 'https://kemlu.go.id' }),
    ]);
  });

  it('uses registry-verified research preflight sources for operator evidence', () => {
    const brief = buildBlogEngineV2Brief({
      blogHtml: '# 캐나다 로키 대중교통\n\n공식 요금과 예약 조건을 비교합니다.',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        information_research_preflight: {
          version: 'r18-research-first-v1',
          passed: true,
          official_source_urls: [
            'https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise',
            'https://roamtransit.com/fares/',
          ],
        },
      },
    });

    expect(brief.evidence_items.filter((item) => item.kind === 'official_source')).toEqual([
      expect.objectContaining({
        url: 'https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise',
        source: 'verified_research_preflight',
      }),
      expect.objectContaining({
        url: 'https://roamtransit.com/fares/',
        source: 'verified_research_preflight',
      }),
    ]);
  });

  it('does not trust failed or unversioned research preflight metadata', () => {
    const brief = buildBlogEngineV2Brief({
      blogHtml: '# 교통 정보\n\n검증되지 않은 외부 링크는 근거가 아닙니다.',
      generationMeta: {
        writer: 'info_writer',
        information_research_preflight: {
          passed: true,
          official_source_urls: ['https://example.com/not-reviewed'],
        },
      },
    });

    expect(brief.evidence_items.filter((item) => item.kind === 'official_source')).toEqual([]);
  });

  it('passes an evidence-backed informational post with bottom-soft CTA', () => {
    const blogHtml = `# 발리 가족 여행 경비

발리 가족 여행 경비는 항공, 숙소, 현지 이동비를 먼저 나눠 보면 됩니다. 3인 가족이라면 성수기 항공권과 리조트 위치가 총액 차이를 가장 크게 만듭니다.

## 비용 판단표
| 항목 | 확인 기준 | 메모 |
| --- | --- | --- |
| 항공 | 출발일 | 성수기 변동 |
| 숙소 | 지역 | 이동비 차이 |
| 식비 | 동선 | 리조트 포함 여부 |

## 공식 확인
[인도네시아 입국 정보](https://kemlu.go.id)

## 내 일정 기준으로 확인하기
마지막에는 내 일정과 인원 기준으로 가능 여부만 확인하세요.
`;

    const evaluation = evaluateBlogEngineV2({
      blogHtml,
      primaryKeyword: '발리 가족 여행 경비',
      destination: '발리',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: {
          reader_question: '발리 가족 여행 경비는 얼마인가요?',
          answer_first: '항공, 숙소, 현지 이동비를 먼저 나눠 보면 됩니다.',
          official_sources_required: true,
        },
        content_brief: {
          search_intent: 'cost',
          evidence: ['검색자는 3인 가족 기준 총액을 궁금해한다.'],
        },
      },
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.score).toBeGreaterThanOrEqual(80);
    expect(evaluation.brief.evidence_items.some((item) => item.kind === 'official_source')).toBe(true);
    expect(evaluation.category_scores.map((category) => category.id)).toEqual([
      'reader_task_completion',
      'customer_language',
      'naturalness',
      'evidence_faithfulness',
      'sales_pressure_control',
    ]);
    expect(evaluation.category_scores.every((category) => category.passed)).toBe(true);
  });

  it('blocks informational posts without evidence', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: `# 다낭 준비물

다낭 준비물은 날씨와 숙소 위치를 기준으로 먼저 확인하면 됩니다. 우기에는 방수 준비, 카드, 현금, 상비약을 나눠 챙기세요.

## 체크리스트
- 여권
- 카드
- 현금
- 상비약
- 방수팩
`,
      primaryKeyword: '다낭 준비물',
      destination: '다낭',
      generationMeta: { writer: 'info_writer' },
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.failure_bucket).toBe('evidence_insufficient');
  });

  it('treats customer travel need openings as complete answer-first intros', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: [
        '# 해외여행 보험 꼭 필요한가요?',
        '',
        '해외여행 보험은 출발 전 항공 지연, 병원 이용, 수하물 분실, 현지 결제 가능 범위를 먼저 나눠 보면 필요 여부를 판단하기 쉽습니다. 여행 기간, 동행자 나이, 기존 카드 보험, 목적지 의료비를 확인한 뒤 부족한 보장만 추가하세요.',
        '',
        '## 보험 판단표',
        '| 상황 | 먼저 볼 것 | 메모 |',
        '| --- | --- | --- |',
        '| 가족여행 | 병원비와 동행자 나이 | 보장 한도를 확인합니다. |',
        '| 짧은 일정 | 항공 지연과 수하물 | 카드 보험과 중복을 봅니다. |',
        '| 장거리 | 의료비와 긴급 연락 | 목적지 의료비를 확인합니다. |',
        '',
        '## 공식 확인',
        '[외교부 해외안전여행](https://www.0404.go.kr/)',
      ].join('\n'),
      primaryKeyword: '해외여행 보험',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: {
          reader_question: '해외여행 보험은 꼭 필요한가요?',
          official_sources_required: true,
        },
      },
    });

    expect(evaluation.category_scores.find((category) => category.id === 'reader_task_completion')?.score).toBe(100);
  });

  it('does not treat hero image alt text as the answer-first paragraph', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: [
        '# 시드니 7월 날씨',
        '',
        '![시드니 여행 이미지](https://images.example.com/sydney.jpg)',
        '',
        '시드니 7월 날씨는 겨울 기준으로 낮 기온, 비 예보, 바람을 함께 봐야 합니다. 출발 7일 전에는 겉옷과 방수용품, 실내외 이동 시간을 다시 확인하세요.',
        '',
        '## 월별 날씨 체크표',
        '',
        '| 구간 | 날씨 포인트 | 옷차림 준비 |',
        '| --- | --- | --- |',
        '| 7월 | 겨울이라 아침저녁이 쌀쌀합니다. | 겉옷을 준비합니다. |',
        '| 비 예보 | 이동 동선에 영향을 줄 수 있습니다. | 우산을 챙깁니다. |',
        '| 바람 | 해안가 체감온도가 낮을 수 있습니다. | 방풍 겉옷을 챙깁니다. |',
        '',
        '## 공식 확인',
        '[외교부 해외안전여행](https://www.0404.go.kr/)',
      ].join('\n'),
      primaryKeyword: '시드니',
      destination: '시드니',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: { official_sources_required: true },
        content_brief: { search_intent: 'weather' },
      },
    });

    expect(evaluation.metrics.task_completion).toBe(100);
    expect(evaluation.passed).toBe(true);
  });

  it('requires external source evidence when an info brief marks official sources required', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: [
        '# 몽골 7월 날씨',
        '',
        '몽골 7월 날씨는 낮에는 덥고 밤에는 쌀쌀해서 얇은 긴팔과 방풍 겉옷을 함께 준비하는 편이 좋습니다.',
        '',
        '## 준비 체크',
        '| 항목 | 확인 기준 | 메모 |',
        '| --- | --- | --- |',
        '| 낮 | 햇볕 | 선글라스와 모자 |',
        '| 밤 | 일교차 | 겉옷 준비 |',
        '| 비 | 소나기 | 우비 준비 |',
      ].join('\n'),
      primaryKeyword: '몽골 7월 날씨',
      destination: '몽골',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: {
          reader_question: '몽골 7월 날씨와 옷차림은 어떻게 준비하나요?',
          answer_first: '낮/밤 일교차와 소나기를 함께 확인합니다.',
          official_sources_required: true,
        },
        content_brief: {
          search_intent: 'weather',
          evidence: ['기상 정보 확인 필요'],
        },
      },
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.failure_bucket).toBe('evidence_insufficient');
    expect(evaluation.metrics.source_support).toBe(35);
    expect(evaluation.category_scores.find((category) => category.id === 'evidence_faithfulness')?.passed).toBe(false);
  });

  it('does not pass near-100 informational posts as publish-ready', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: [
        '# 세부 숙소 지역별 예산',
        '',
        '세부 숙소 지역별 예산은 여행 전에 전체 흐름을 알아두면 도움이 됩니다. 여러 조건이 달라질 수 있으므로 차분하게 살펴보는 것이 좋습니다.',
        '',
        '## 예산 비교표',
        '| 항목 | 확인 기준 | 주의할 점 |',
        '| --- | --- | --- |',
        '| 숙소 | 위치와 조식 포함 여부 | 이동비가 달라질 수 있습니다. |',
        '| 교통 | 공항 이동과 시내 이동 | 가족 여행은 차량 조건을 봐야 합니다. |',
        '| 식사 | 1인 1끼 기준 | 리조트 안팎 가격이 다릅니다. |',
        '',
        '## 공식 확인',
        '[외교부 해외안전여행](https://www.0404.go.kr/)',
      ].join('\n'),
      primaryKeyword: '세부 숙소 지역별 예산',
      destination: '세부',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: {
          reader_question: '세부 숙소 지역별 예산은 어떻게 봐야 하나요?',
          answer_first: '숙소 위치와 이동비를 먼저 나눠 봅니다.',
          official_sources_required: true,
        },
        content_brief: {
          search_intent: 'cost',
          evidence: ['숙소 위치별 총액 비교 필요'],
        },
      },
    });

    expect(evaluation.score).toBeLessThan(100);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.failure_bucket).toBe('engine_task_incomplete');
    expect(evaluation.category_scores.find((category) => category.id === 'reader_task_completion')?.passed).toBe(false);
  });

  it('treats readable Korean opening CTA as sales pressure for info writer posts', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: [
        '# 몽골 6월 날씨와 옷차림 준비물 체크',
        '',
        '몽골 6월 날씨는 먼저 일교차, 비포장 이동 동선, 방풍 준비를 확인하면 판단이 쉽습니다. 지금 예약하기 전에 상담 신청을 바로 남기면 잔여 좌석도 빠르게 볼 수 있습니다.',
        '',
        '## 날씨 판단 기준',
        '| 항목 | 확인 기준 | 주의할 점 |',
        '| --- | --- | --- |',
        '| 낮 기온 | 일교차 | 얇은 겉옷을 준비합니다. |',
        '| 이동 | 비포장 구간 | 방풍과 방진 준비가 필요합니다. |',
        '| 일정 | 숙소 위치 | 이동 시간이 달라집니다. |',
        '',
        '## 공식 확인',
        '[외교부 해외안전여행](https://www.0404.go.kr/)',
      ].join('\n'),
      primaryKeyword: '몽골 6월 날씨',
      destination: '몽골',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: {
          reader_question: '몽골 6월 날씨와 옷차림은 어떻게 준비하나요?',
          answer_first: '일교차와 이동 동선을 먼저 확인합니다.',
          official_sources_required: true,
        },
        content_brief: {
          search_intent: 'weather',
          evidence: ['기상 정보 확인 필요'],
        },
      },
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.failure_bucket).toBe('sales_pressure');
    expect(evaluation.metrics.sales_pressure).toBe(35);
  });

  it('allows a bottom-soft CTA when the final surface repair demotes the heading to a bold label', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: [
        '# 몽골 7월 날씨와 옷차림',
        '',
        '몽골 7월 날씨는 낮과 밤의 기온 차이, 소나기 가능성, 차량 이동 시간을 먼저 나눠 보면 준비물이 분명해집니다.',
        '',
        '## 날씨 판단 기준',
        '| 항목 | 확인 기준 | 주의할 점 |',
        '| --- | --- | --- |',
        '| 낮 | 햇볕과 자외선 | 얇은 긴팔을 준비합니다. |',
        '| 밤 | 일교차 | 방풍 겉옷을 챙깁니다. |',
        '| 비 | 소나기 | 우비와 방수팩을 챙깁니다. |',
        '',
        '## 공식 확인',
        '[외교부 해외안전여행](https://www.0404.go.kr/)',
        '',
        '**여행 상품과 함께 확인하기**',
        '',
        '- [현재 판매 중인 여행상품 보기](/packages?destination=mongolia)',
        '- [내 일정에 맞는 상품 상담하기](/group-inquiry)',
      ].join('\n'),
      primaryKeyword: '몽골 7월 날씨',
      destination: '몽골',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: {
          reader_question: '몽골 7월 날씨와 옷차림은 어떻게 준비하나요?',
          answer_first: '낮과 밤의 기온 차이, 소나기 가능성, 차량 이동 시간을 나눠 봅니다.',
          official_sources_required: true,
        },
        content_brief: {
          search_intent: 'weather',
          evidence: ['기상 정보 확인 필요'],
        },
      },
    });

    expect(evaluation.metrics.sales_pressure).toBe(100);
    expect(evaluation.category_scores.find((category) => category.id === 'sales_pressure_control')?.passed).toBe(true);
  });

  it('does not score Kakao T Guam Taxi evidence as sales pressure', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: [
        '# 괌 공항에서 투몬까지 이동수단',
        '',
        '괌 공항 이동수단은 확인된 요금과 수하물 조건을 나눠 비교하면 선택이 분명해집니다.',
        '카카오 T 괌택시는 비행편명 입력 안내를 제공합니다.',
        '',
        '## 출발 전 확인',
        '공식 앱에서 최신 승차 위치를 확인하세요.',
        '',
        '## 도착 후 확인',
        '하차 위치를 숙소 안내와 대조하세요.',
      ].join('\n'),
      primaryKeyword: '괌 공항 투몬 교통',
      destination: '괌',
      generationMeta: {
        writer: 'info_writer',
        info_guide_brief: {
          reader_question: '괌 공항에서 투몬까지 무엇을 타야 하나요?',
          answer_first: '요금과 수하물 조건을 나눠 비교합니다.',
          official_sources_required: true,
        },
        content_brief: { search_intent: 'transport', evidence: ['공식 교통 안내'] },
      },
    });

    expect(evaluation.metrics.sales_pressure).toBe(100);
  });

  it('blocks customer-language defects that make otherwise structured posts feel machine-written', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: [
        '# 광저우 4박6일 패키지',
        '',
        '광저우은 가격만 보지 말고 출발지, 포함사항, 일정 강도를 같이 봐야 판단이 쉽습니다. 대학생에서 먼저 볼 것은 비용·일정·현지 준비 조건입니다.',
        '',
        '## 10초 판단',
        '| 확인 항목 | 현재 기준 | 문의 전 볼 점 |',
        '| --- | --- | --- |',
        '| 가격 | 749,000원부터 | 출발일별 확인 |',
        '| 기간 | 4박6일 | 이동 부담 확인 |',
        '| 포함 | 항공/호텔 | 불포함 확인 |',
        '',
        '## 포함/불포함',
        '| 구분 | 항목 | 확인 포인트 |',
        '| --- | --- | --- |',
        '| 포함 | 항공 | 상담 확인 |',
        '| 포함 | 호텔 | 상담 확인 |',
        '| 불포함 | 개인경비 | 상담 확인 |',
        '',
        '## 이런 분께 맞습니다',
        '- 가격과 일정을 비교하려는 고객',
        '',
        '## 이런 분께는 맞지 않을 수 있습니다',
        '- 자유일정 비중이 큰 여행을 원하는 고객',
        '',
        '## 가격이 달라질 수 있는 조건',
        '- 가격과 좌석은 발권 시점에 달라질 수 있음',
        '',
        '## 문의 전 질문',
        '- 인원과 출발 가능일이 어떻게 되나요?',
      ].join('\n'),
      primaryKeyword: '광저우 패키지',
      destination: '광저우',
      contentType: 'package_intro',
      productId: 'pkg_456',
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          included: ['항공', '호텔'],
          excluded: ['개인경비'],
          fit_for: ['가격과 일정 비교 고객'],
          not_fit_for: ['자유일정 선호 고객'],
          risk_notes: ['가격과 좌석은 달라질 수 있음'],
          consult_questions: ['인원과 출발 가능일이 어떻게 되나요?'],
        },
      },
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.failure_bucket).toBe('customer_language');
    expect(evaluation.metrics.customer_language).toBeLessThan(80);
  });

  it('passes product consultant posts only when DB-backed decision blocks exist', () => {
    const blogHtml = `# 발리 4박5일 패키지: 899,000원부터, 이런 분께 맞습니다

인천 출발 발리 4박5일 상품을 보고 있다면 포함사항과 일정 체감을 먼저 확인하세요.

## 10초 판단
| 확인 항목 | 현재 기준 | 문의 전 볼 점 |
| --- | --- | --- |
| 가격 | 899,000원부터 | 출발일별 확인 |
| 기간 | 4박5일 | 이동 부담 확인 |
| 포함 | 항공/호텔 | 불포함 확인 |

## 포함/불포함
| 구분 | 항목 | 확인 포인트 |
| --- | --- | --- |
| 포함 | 항공 | 상담 확인 |
| 포함 | 호텔 | 상담 확인 |
| 불포함 | 개인경비 | 상담 확인 |

## 이런 분께 맞습니다
- 가족 패키지를 가격과 일정 기준으로 비교하려는 고객

## 이런 분께는 맞지 않을 수 있습니다
- 자유일정 비중이 큰 여행을 원하는 고객

## 가격이 달라질 수 있는 조건
- 가격과 좌석은 발권 시점에 달라질 수 있음

## 문의 전 질문
- 인원과 출발 가능일이 어떻게 되나요?
`;
    const evaluation = evaluateBlogEngineV2({
      blogHtml,
      primaryKeyword: '발리 패키지',
      destination: '발리',
      contentType: 'package_intro',
      productId: 'pkg_123',
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          price_from: 899000,
          departure_city: '인천',
          duration: '4박5일',
          included: ['항공', '호텔'],
          excluded: ['개인경비'],
          fit_for: ['가족 패키지 비교 고객'],
          not_fit_for: ['자유일정 선호 고객'],
          risk_notes: ['가격과 좌석은 달라질 수 있음'],
          consult_questions: ['인원과 출발 가능일이 어떻게 되나요?'],
        },
      },
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.metrics.product_decision_helpfulness).toBe(100);
    expect(evaluation.category_scores.map((category) => category.id)).toContain('product_decision_helpfulness');
    expect(evaluation.category_scores.every((category) => category.score === 100)).toBe(true);
  });

  it('builds the public V2 brief shape from generation meta', () => {
    const brief = buildBlogEngineV2Brief({
      blogHtml: '[공식](https://example.com)',
      primaryKeyword: '발리 패키지',
      destination: '발리',
      contentType: 'package_intro',
      productId: 'pkg_123',
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: {
          included: ['항공'],
          excluded: ['개인경비'],
          fit_for: ['가족'],
          not_fit_for: ['자유여행'],
          risk_notes: ['가격 변동'],
          consult_questions: ['출발 가능일?'],
        },
      },
    });

    expect(brief).toMatchObject({
      writer_type: 'product_consultant_writer',
      primary_keyword: '발리 패키지',
      destination: '발리',
      cta_policy: 'product_consult',
      product_id: 'pkg_123',
    });
    expect(brief.evidence_items.some((item) => item.kind === 'product_db')).toBe(true);
  });

  it('scores the first body paragraph instead of the H1 title', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: [
        '# 7월 호주 시드니 여행, 한국과 반대! 겨울 날씨와 즐길 거리',
        '',
        '시드니 날씨는 낮 최고기온보다 일교차, 비 예보, 이동 동선을 함께 봐야 합니다. 출발 7일 전에는 겉옷·방수용품·자외선 차단 품목을 다시 확인하는 편이 좋습니다.',
        '',
        '## 월별 날씨 체크표',
        '',
        '| 구간 | 확인 포인트 | 옷차림 준비 |',
        '| --- | --- | --- |',
        '| 6~8월 | 우기·강수 가능성 확인 | 우산, 방수 가방, 통풍 옷 |',
      ].join('\n'),
      primaryKeyword: '시드니',
      destination: '시드니',
      contentType: 'guide',
      generationMeta: { writer: 'info_writer' },
    });

    expect(evaluation.metrics.task_completion).toBe(100);
  });

  it('accepts a direct V3 decision answer without forcing a number into the opening', () => {
    const evaluation = evaluateBlogEngineV2({
      blogHtml: [
        '# 다낭 가볼만한곳 선택 기준',
        '',
        '다낭에서 어디를 갈지는 내 일정의 시간과 동행자의 체력, 원하는 경험을 먼저 비교해 고릅니다. 아래 공식 정보에 내 우선순위를 대입하면 선택지를 좁힐 수 있습니다.',
        '',
        '## 오행산 공식 정보',
        '',
        '[공식 근거](https://vietnam.travel/things-to-do/must-visit-places-in-da-nang)',
      ].join('\n'),
      primaryKeyword: '다낭 가볼만한곳 선택 기준',
      destination: '다낭',
      contentType: 'guide',
      generationMeta: {
        writer: 'info_writer',
        content_brief_v3: { version: 'blog-quality-v3.1' },
      },
    });

    expect(evaluation.metrics.task_completion).toBe(100);
  });
});
