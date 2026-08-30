import { describe, expect, it } from 'vitest';
import { classifyBlogIntent, inspectBlogIntentQuality } from './blog-content-intent';

describe('blog content intent quality', () => {
  it('accepts Korean budget ranges in customer-facing cost posts', () => {
    const report = inspectBlogIntentQuality({
      title: '석가장 여행 비용 가이드',
      primaryKeyword: '석가장 여행 비용',
      category: 'cost',
      contentType: 'guide',
      blogHtml: [
        '# 석가장 여행 비용 가이드',
        '',
        '석가장 비용은 상품가와 현지 개인경비를 나눠 봐야 합니다. 식사와 간식은 1인 하루 3만~7만원, 현지 교통은 1만~3만원 정도를 별도 예산으로 잡으면 총액 오차를 줄일 수 있습니다.',
        '',
        '## 현실 예산 범위',
        '- 식사와 간식은 1인 하루 3만~7만원 정도를 봅니다.',
        '- 현지 교통과 소액 결제는 1인 하루 1만~3만원 정도를 준비합니다.',
        '- 선택 관광은 1인 5만~15만원 이상 추가될 수 있어 상품가와 분리합니다.',
        '- 환율과 성수기 조건은 결제 전 다시 확인합니다.',
        '- 포함/불포함과 취소 규정을 같이 확인합니다.',
      ].join('\n'),
    });

    expect(report.intent.infoSubtype).toBe('cost');
    expect(report.issues.some((issue) => issue.message.includes('Cost/currency posts need concrete amounts'))).toBe(false);
  });

  it('accepts Korean budget ranges even when the budget block appears after the intro', () => {
    const title = '\uC11D\uAC00\uC7A5 \uC5EC\uD589 \uBE44\uC6A9 \uAC00\uC774\uB4DC 2026';
    const report = inspectBlogIntentQuality({
      title,
      primaryKeyword: '\uC11D\uAC00\uC7A5 \uC5EC\uD589 \uBE44\uC6A9',
      category: 'travel_tips',
      contentType: 'guide',
      destination: '\uC11D\uAC00\uC7A5',
      blogHtml: [
        `# ${title}`,
        '',
        `${'\uCD9C\uBC1C \uC804\uC5D0 \uB3D9\uC120\uACFC \uCD94\uAC00 \uACB0\uC81C \uC870\uAC74\uC744 \uBA3C\uC800 \uD655\uC778\uD558\uBA74 \uD604\uC9C0 \uC608\uC0B0 \uC624\uCC28\uB97C \uC904\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4. '.repeat(25)}`,
        '',
        '## \uBE44\uC6A9 \uAE30\uC900 \uB2E4\uC2DC \uBCF4\uAE30',
        '| \uD56D\uBAA9 | \uBCF4\uB294 \uAE30\uC900 |',
        '| --- | --- |',
        '| \uD604\uC9C0 \uAD50\uD1B5 | 1\uD68C \uC774\uB3D9\uBE44\uC640 1\uC77C \uAD50\uD1B5\uBE44 1\uB9CC\uC6D0 \uB2E8\uC704 |',
        '| \uC2DD\uC0AC/\uAC04\uC2DD | 1\uC778 1\uB07C \uAE30\uC900 \uC608\uC0B0 2\uB9CC\uC6D0 \uB2E8\uC704 |',
        '| \uC120\uD0DD \uAD00\uAD11 | 1\uC778 \uCD94\uAC00 \uBE44\uC6A9 3\uB9CC\uC6D0 \uC774\uC0C1 \uC5EC\uBD80 |',
        '',
        '## \uD604\uC2E4 \uC608\uC0B0 \uBC94\uC704',
        '- \uC2DD\uC0AC\uC640 \uAC04\uC2DD\uC740 1\uC778 \uD558\uB8E8 3\uB9CC~7\uB9CC\uC6D0 \uC815\uB3C4\uB85C \uBCF4\uB294 \uD3B8\uC774 \uC88B\uC2B5\uB2C8\uB2E4.',
        '- \uD604\uC9C0 \uAD50\uD1B5\uACFC \uC18C\uC561 \uACB0\uC81C\uB294 1\uC778 \uD558\uB8E8 1\uB9CC~3\uB9CC\uC6D0 \uC815\uB3C4\uB97C \uB530\uB85C \uC900\uBE44\uD569\uB2C8\uB2E4.',
        '- \uC120\uD0DD \uAD00\uAD11\uC774 \uC788\uC73C\uBA74 1\uC778 5\uB9CC~15\uB9CC\uC6D0 \uC774\uC0C1 \uB298\uC5B4\uB0A0 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
      ].join('\n'),
    });

    expect(report.intent.infoSubtype).toBe('cost');
    expect(report.issues.some((issue) => issue.message.includes('Cost/currency posts need concrete amounts'))).toBe(false);
  });

  it('does not apply product ranking contracts to information-only posts', () => {
    const intent = classifyBlogIntent({
      title: '나가사키 현지 맛집 BEST와 호텔 근처 음식 가이드',
      category: 'food',
      contentType: 'guide',
      blogHtml: '나가사키 여행자가 참고할 현지 음식, 이동 동선, 예산 정보를 정리합니다.',
    });

    expect(intent.mode).toBe('info');
    expect(intent.productSubtype).toBeNull();
  });

  it('uses title and category over incidental weather terms in the body', () => {
    const preparation = classifyBlogIntent({
      title: '보홀 여행 준비물 체크리스트',
      category: 'preparation',
      contentType: 'guide',
      blogHtml: '보홀은 우기와 건기 차이가 있어 날씨, 옷차림, 기온을 함께 확인하면 좋습니다.',
    });
    const food = classifyBlogIntent({
      title: '나가사키 현지 맛집 BEST와 음식 동선',
      category: 'food',
      contentType: 'guide',
      blogHtml: '비 오는 날씨에는 실내 식당을 먼저 잡고, 우기에는 택시 이동을 고려하세요.',
    });
    const itinerary = classifyBlogIntent({
      title: '보홀 3박4일 일정과 이동 코스',
      category: 'itinerary',
      contentType: 'guide',
      blogHtml: '우기에는 해상 날씨에 따라 이동 시간이 달라질 수 있습니다.',
    });

    expect(preparation.infoSubtype).toBe('preparation');
    expect(food.infoSubtype).toBe('food');
    expect(itinerary.infoSubtype).toBe('itinerary');
  });

  it('uses clear body evidence as a minimum intent contract when metadata is thin', () => {
    const report = inspectBlogIntentQuality({
      title: '여행 준비 가이드',
      contentType: 'guide',
      blogHtml: [
        '# 여행 준비 가이드',
        '',
        '답부터 말하면 공항 이동비, 택시 요금, 하루 교통비를 따로 비교해야 예산 오차를 줄일 수 있습니다.',
        '',
        '## 비용 판단표',
        '| 항목 | 확인 기준 | 예상 범위 |',
        '| --- | --- | ---: |',
        '| 공항 이동 | 픽업 또는 택시 | 30,000원 |',
        '| 시내 이동 | 대중교통 또는 차량 | 20,000원 |',
        '| 예비비 | 대기와 우회 동선 | 10,000원 |',
      ].join('\n'),
    });

    expect(report.intent.infoSubtype).toBe('cost');
    expect(report.issues.some((issue) => issue.code === 'missing_intent_contract')).toBe(false);
  });

  it('classifies transport cost topics as cost even when stale category says weather', () => {
    const intent = classifyBlogIntent({
      title: '몽골 렌터카 택시 픽업 이동비 비교 2026',
      slug: 'mongolia-transport-cost',
      primaryKeyword: '몽골 렌터카 택시 픽업 이동비',
      category: 'weather',
      contentType: 'guide',
      blogHtml: '비 예보가 있어도 이 글의 핵심은 공항 픽업, 렌터카, 택시 이동비와 하루 교통비 비교입니다.',
    });

    expect(intent.mode).toBe('info');
    expect(intent.infoSubtype).toBe('cost');
  });

  it('uses a specific cost slug over stale weather category when scores tie', () => {
    const intent = classifyBlogIntent({
      title: '몽골 여행',
      slug: 'mongolia-transport-cost',
      primaryKeyword: '몽골 여행',
      category: 'weather',
      contentType: 'guide',
      blogHtml: '날씨와 옷차림도 확인하지만, 핵심은 공항 픽업과 택시 이동비 비교입니다.',
    });

    expect(intent.infoSubtype).toBe('cost');
    expect(intent.evidence).toContain('cost terms in category/type');
  });

  it('blocks sales tone in informational weather posts', () => {
    const report = inspectBlogIntentQuality({
      title: '장가계 날씨 월별 옷차림',
      primaryKeyword: '장가계 날씨',
      category: 'weather',
      contentType: 'guide',
      blogHtml: `# 장가계 날씨 월별 옷차림

## 월별 장가계 날씨

| 월 | 기온 | 옷차림 |
| --- | --- | --- |
| 1월 | 2도 | 패딩 |
| 4월 | 15도 | 얇은 겉옷 |
| 7월 | 28도 | 반팔과 우비 |
| 10월 | 17도 | 가벼운 외투 |

## 장가계 여행 옷차림 체크리스트
- 방수 재킷
- 미끄럼 방지 신발
- 얇은 겉옷
- 우산

## 우기와 건기 리스크
==7월과 8월은 강수량이 높아 방수 준비가 필요합니다.==

:::tip
천문산 일정은 비 예보가 있으면 오전으로 앞당기세요.
:::

## 이 상품을 고른 이유
출발가와 예약 마감 정보를 확인하세요.
`,
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'forbidden_sales_tone')).toBe(true);
  });

  it('passes a scan-friendly weather post contract', () => {
    const report = inspectBlogIntentQuality({
      title: '장가계 날씨 월별 옷차림',
      primaryKeyword: '장가계 날씨',
      category: 'weather',
      contentType: 'guide',
      blogHtml: `# 장가계 날씨 월별 옷차림

2026년 기준 장가계 날씨는 봄과 가을이 걷기 좋고, 여름은 우기 대응이 핵심입니다. 부모님 동반 일정이라면 월별 기온보다 계단 이동, 우비 준비, 케이블카 대기 가능성을 먼저 확인하는 편이 좋습니다.

## 월별 장가계 날씨 표

| 월 | 평균 기온 | 강수 특징 | 추천 옷차림 |
| --- | ---: | --- | --- |
| 1월 | 2도 | 건조 | 패딩 |
| 3월 | 10도 | 비 증가 | 니트와 겉옷 |
| 5월 | 20도 | 소나기 | 얇은 긴팔 |
| 7월 | 28도 | 우기 | 반팔과 우비 |
| 10월 | 17도 | 맑음 | 가벼운 외투 |

## 옷차림 체크리스트
- 미끄럼 방지 운동화
- 방수 재킷
- 접이식 우산
- 얇은 겉옷
- 여벌 양말

## 우기와 건기 리스크
7월과 8월은 강수량이 높아 천문산 케이블카 대기 시간이 30분 이상 늘 수 있습니다.

:::tip
비 예보가 있으면 유리다리보다 실내 이동이 쉬운 일정부터 배치하세요.
:::

## 부모님 여행 날씨 팁
60대 이상은 계단 이동이 길어 체감온도 5도 차이를 기준으로 겉옷을 준비하는 편이 좋습니다.

## 자주 묻는 질문
Q. 장가계 여행은 몇 월이 좋나요?
A. 4월, 5월, 9월, 10월이 걷기 좋습니다.
`,
    });

    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(85);
  });

  it('blocks preparation posts without checklist structure', () => {
    const report = inspectBlogIntentQuality({
      title: '베트남 여행 준비물',
      primaryKeyword: '베트남 여행 준비물',
      category: 'preparation',
      contentType: 'guide',
      blogHtml: `# 베트남 여행 준비물

## 준비물

베트남 여행 준비물은 여권, 카드, 현금, 충전기, 옷을 챙기면 됩니다. 더운 날씨라 가벼운 옷이 좋고 우산도 있으면 좋습니다.
`,
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'weak_list_or_table_shape')).toBe(true);
  });

  it('blocks generic info openings and early hard CTAs', () => {
    const report = inspectBlogIntentQuality({
      title: '발리 가족 여행 경비',
      primaryKeyword: '발리 가족 여행 경비',
      category: 'cost',
      contentType: 'guide',
      blogHtml: `# 발리 가족 여행 경비

안녕하세요. 여소남 에디터가 추천하는 발리 가족 여행 경비 완벽 가이드입니다.

[지금 상품 보기](/packages?destination=발리)

## 비용 표
| 항목 | 비용 |
| --- | ---: |
| 항공 | 1,800,000원 |
| 호텔 | 1,200,000원 |
| 식비 | 600,000원 |

## 체크리스트
- 항공권
- 호텔
- 식비
- 이동비
- 선택관광
`,
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'missing_answer_first')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'early_strong_cta')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'repeated_ai_opening_pattern')).toBe(true);
  });

  it('treats Kakao T Guam Taxi as transport evidence, not a consultation CTA', () => {
    const report = inspectBlogIntentQuality({
      title: '괌 공항에서 투몬까지 이동수단',
      primaryKeyword: '괌 공항 투몬 교통',
      category: 'transport',
      contentType: 'guide',
      blogHtml: `# 괌 공항에서 투몬까지 이동수단

괌 공항 이동수단은 확인된 요금과 수하물 조건을 나눠 비교하면 선택이 분명해집니다. 카카오 T 괌택시는 비행편명 입력 안내를 제공합니다.

## 출발 전 확인

공식 앱에서 최신 승차 위치를 확인하세요.

## 도착 후 확인

하차 위치를 숙소 안내와 대조하세요.`,
    });

    expect(report.issues.some((issue) => issue.code === 'early_strong_cta')).toBe(false);
  });

  it('flags machine-looking title separators, broken persona copy, and English micro-angle image alts', () => {
    const report = inspectBlogIntentQuality({
      title: '오사카 7월 날씨 여행 가이드 2026|월별 날씨·옷차림 체크리스트',
      primaryKeyword: '오사카 7월 날씨',
      category: 'weather',
      contentType: 'guide',
      blogHtml: `# 오사카 7월 날씨 여행 가이드 2026|월별 날씨·옷차림 체크리스트

오사카 7월 날씨는 고온다습하고 소나기가 잦아 통풍 좋은 옷, 접이식 우산, 실내 대체 일정을 먼저 확인해야 합니다.

안녕하세요! 친구에게 좋은 여행을 추천해 드리는 입니다.

![오사카 참고 이미지 1 osaka july weather clothes](https://example.com/osaka.jpg)

## 예약 전 무엇을 먼저 확인해야 할까요?
답부터 말하면 항공 시간, 실내 대체 일정, 더위 대응 준비물을 함께 확인해야 합니다.

## 날씨 기준
- 평균 기온 28도 이상
- 강수 가능성 확인
- 냉방 대비 겉옷 준비

## 준비물 체크
| 항목 | 이유 |
| --- | --- |
| 우산 | 소나기 대비 |
| 얇은 겉옷 | 실내 냉방 대비 |
| 보조배터리 | 이동 중 지도 확인 |

## 공식 확인
- [외교부 해외안전여행](https://www.0404.go.kr/)

## 자주 묻는 질문
Q. 비가 와도 여행할 수 있나요?
A. 짧은 소나기라면 실내 동선을 섞어 조정하는 편이 안전합니다.
`,
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'machine_title_format')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'broken_editorial_voice')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'generic_image_alt')).toBe(true);
  });

  it('blocks unsupported Yeosonam data claims', () => {
    const report = inspectBlogIntentQuality({
      title: '다낭 여행 준비물',
      primaryKeyword: '다낭 여행 준비물',
      category: 'preparation',
      contentType: 'guide',
      blogHtml: `# 다낭 여행 준비물

다낭 여행 준비물은 우기 여부와 숙소 위치를 기준으로 먼저 나누면 됩니다. 가족 여행이라면 상비약, 방수 준비, 결제 수단을 먼저 확인하세요.

## 준비물 체크리스트
- 여권
- 카드
- 현금
- 상비약
- 방수팩

## 판단 기준
여소남 데이터로 보면 이 준비물이 가장 좋습니다.
`,
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'unsupported_yeosonam_data')).toBe(true);
  });

  it('blocks semantic surface defects that make posts read like generated copy', () => {
    const report = inspectBlogIntentQuality({
      title: '보라카이 7월 날씨 여행 가이드 2026 | 월별 날씨 · 옷차림 체크리스트',
      primaryKeyword: '보라카이 7월 날씨',
      category: 'weather',
      contentType: 'guide',
      blogHtml: [
        '# 보라카이 7월 날씨 여행 가이드',
        '',
        '보라카이는 푸른 자연을 즐기기할 수 있어 가족 여행객에게 좋습니다.',
        '',
        '![현지 참고 이미지 3 현지 가이드 옷차림](/images/boracay.jpg)',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'awkward_korean_surface')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'placeholder_destination_context')).toBe(true);
  });

  it('blocks SEO titles whose visible intent conflicts with the topic', () => {
    const report = inspectBlogIntentQuality({
      title: '여름 휴가 해외여행자 보험 여행 가이드 2026 | 월별 날씨 · 옷차림 체크리스트',
      primaryKeyword: '여름 휴가 해외여행자 보험',
      category: 'insurance',
      contentType: 'guide',
      blogHtml: [
        '# 여름 휴가 해외여행자 보험',
        '',
        '해외여행자 보험은 보장 범위와 자기부담금을 먼저 확인해야 합니다.',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'title_intent_mismatch')).toBe(true);
  });

  it('blocks generated image context and repeated answer-first scaffolds', () => {
    const report = inspectBlogIntentQuality({
      title: '몽골 숙소 지역별 예산 여행 가이드 2026',
      primaryKeyword: '몽골 숙소 지역별 예산',
      destination: '몽골',
      category: 'cost',
      contentType: 'guide',
      blogHtml: [
        '# 몽골 숙소 지역별 예산 여행 가이드',
        '',
        '답부터 말하면, 몽골 숙소는 울란바토르 시내와 테를지 게르 캠프를 나눠 예산을 봐야 합니다.',
        '',
        '![몽골 숙소 지역별 예산 참고 이미지 3 지역별 가이드 예산과](/images/mongolia.jpg)',
        '<figcaption>몽골 숙소 지역별 예산 참고 이미지 3 지역별 가이드 예산과</figcaption>',
        '',
        '## 예약 전 무엇을 먼저 확인해야 할까요?',
        '',
        '답부터 말하면, 2026년 기준 비용·일정·준비 조건을 함께 확인해야 현지에서 생기는 추가 부담을 줄일 수 있습니다.',
        '',
        '## 숙소 예산 표',
        '',
        '| 지역 | 기준 | 비용 |',
        '| --- | --- | --- |',
        '| 울란바토르 | 시내 접근 | 7만 원대 |',
        '| 테를지 | 자연 체험 | 5만 원대 |',
        '| 공항 근처 | 늦은 도착 | 8만 원대 |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'generated_image_context')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'repetitive_answer_scaffold')).toBe(true);
  });

  it('blocks placeholder links, local placeholder entities, and duplicated title tokens', () => {
    const report = inspectBlogIntentQuality({
      title: '여행 준비 여행 여행 가이드 2026',
      primaryKeyword: '나가사키 여행 준비',
      destination: '나가사키',
      category: 'preparation',
      contentType: 'guide',
      blogHtml: [
        '# 나가사키 여행 준비',
        '',
        '나가사키 여행은 항공권, 숙소 위치, 교통패스 조건을 먼저 확인하면 준비 시간을 줄일 수 있습니다.',
        '',
        '여소남이 이 이 정보를 정리한 이유는 현지역과 현지항 이동이 헷갈리기 때문입니다.',
        '',
        '## 준비 체크리스트',
        '- 항공권',
        '- 숙소 위치',
        '- 교통패스',
        '- 환전',
        '',
        '## 공식 확인',
        '- [예시링크](https://blog.naver.com/yeosonam/%EC%98%88%EC%8B%9C%EB%A7%81%ED%81%AC)',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'duplicate_title_token')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'placeholder_destination_context')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'placeholder_reference_link')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'awkward_korean_surface')).toBe(true);
  });

  it('blocks unnatural customer-language particles and target wording', () => {
    const report = inspectBlogIntentQuality({
      title: '광저우 4박6일 패키지 가격 조건',
      primaryKeyword: '광저우 패키지',
      destination: '광저우',
      category: 'product',
      contentType: 'package_intro',
      productId: 'pkg_456',
      blogHtml: [
        '# 광저우 4박6일 패키지 가격 조건',
        '',
        '광저우은 가격만 보지 말고 출발지, 포함사항, 일정 강도를 같이 봐야 판단이 쉽습니다. 대학생에서 먼저 볼 것은 비용과 일정입니다.',
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
        '| 불포함 | 개인경비 | 상담 확인 |',
        '| 불포함 | 선택관광 | 상담 확인 |',
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
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'awkward_korean_surface')).toBe(true);
  });

  it('records a redacted raw Markdown context for particle failures', () => {
    const report = inspectBlogIntentQuality({
      title: '미국 입국 요건과 비자',
      primaryKeyword: '미국 입국 요건과 비자',
      blogHtml: '<strong>세관 신고을</strong> 확인합니다. 공식 링크: https://example.com/tracking?utm_source=test',
    });
    const issue = report.issues.find((candidate) =>
      candidate.code === 'awkward_korean_surface'
      && candidate.evidence?.sample === '신고을');

    expect(issue?.evidence?.raw_context).toContain('[url]');
    expect(issue?.evidence?.raw_context).not.toContain('cbp.gov');
    expect(issue?.evidence?.raw_context).not.toContain('utm_source');
  });

  it('does not invent a particle failure when redacting a Markdown link URL', () => {
    const report = inspectBlogIntentQuality({
      title: '미국 입국 요건과 비자',
      primaryKeyword: '미국 입국 요건과 비자',
      blogHtml: [
        '[세관 신고](https://www.cbp.gov/travel)',
        '',
        '적용 범위(공식 조건)을 출발 전에 확인합니다.',
      ].join('\n'),
    });

    expect(report.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'awkward_korean_surface',
        evidence: expect.objectContaining({ sample: '신고을' }),
      }),
    ]));
  });

  it('requires product posts to use consultant decision blocks', () => {
    const report = inspectBlogIntentQuality({
      title: '발리 패키지 상품',
      primaryKeyword: '발리 패키지',
      category: 'product',
      contentType: 'package_intro',
      productId: 'pkg_123',
      blogHtml: `# 발리 패키지 상품

발리 패키지는 가격과 일정이 좋은 상품입니다.

## 상품 소개
특가와 예약 마감 정보를 확인하세요.

## 일정
- 1일차 도착
- 2일차 관광
- 3일차 자유시간

## 가격
899,000원부터입니다.

## 예약
문의하세요.
`,
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'missing_product_consult_block')).toBe(true);
  });

  it('accepts readable Korean product consultant decision blocks', () => {
    const html = [
      '# \uBD80\uC0B0\uCD9C\uBC1C \uB098\uD2B8\uB791 3\uBC155\uC77C \uD328\uD0A4\uC9C0',
      '',
      '\uBD80\uC0B0\uCD9C\uBC1C, 3\uBC155\uC77C, 599,000\uC6D0\uBD80\uD130 \uD655\uC778\uD558\uB294 \uC0C1\uD488\uC785\uB2C8\uB2E4. \uC774\uB3D9\uC744 \uC904\uC774\uACE0 \uD3EC\uD568 \uC870\uAC74\uC744 \uBA3C\uC800 \uBCF4\uB824\uB294 \uBD84\uC5D0\uAC8C \uB9DE\uC2B5\uB2C8\uB2E4.',
      '',
      '## 10\uCD08 \uD310\uB2E8',
      '| \uD655\uC778 \uD56D\uBAA9 | \uD604\uC7AC \uAE30\uC900 | \uBB38\uC758 \uC804 \uBCFC \uAC83 |',
      '| --- | --- | --- |',
      '| \uAC00\uACA9 | 599,000\uC6D0~ | \uCD9C\uBC1C\uC77C\uBCC4 \uBCC0\uB3D9 |',
      '| \uAE30\uAC04 | 3\uBC155\uC77C | \uD56D\uACF5 \uC2DC\uAC04 |',
      '| \uD3EC\uD568 | \uD56D\uACF5/\uD638\uD154 | \uBD88\uD3EC\uD568 \uD655\uC778 |',
      '',
      '## \uD3EC\uD568/\uBD88\uD3EC\uD568',
      '- \uD3EC\uD568 \uC0AC\uD56D: \uD56D\uACF5, \uD638\uD154, \uCC28\uB7C9',
      '- \uBD88\uD3EC\uD568 \uC0AC\uD56D: \uAC1C\uC778\uACBD\uBE44, \uC120\uD0DD\uAD00\uAD11',
      '',
      '## \uB9DE\uB294 \uC0AC\uB78C\uACFC \uC548 \uB9DE\uB294 \uC0AC\uB78C',
      '- \uB9DE\uB294 \uC0AC\uB78C: \uCD9C\uBC1C\uC9C0\uC640 \uAC00\uACA9\uC744 \uBA3C\uC800 \uBCF4\uB294 \uACE0\uAC1D',
      '- \uC548 \uB9DE\uB294 \uC0AC\uB78C: \uD638\uD154\uACFC \uC77C\uC815\uC744 \uBAA8\uB450 \uC9C1\uC811 \uC9DC\uACE0 \uC2F6\uC740 \uACE0\uAC1D',
      '',
      '## \uAC00\uACA9 \uBCC0\uB3D9 \uC870\uAC74',
      '- \uCD9C\uBC1C\uC77C, \uC88C\uC11D, \uD658\uC728\uC5D0 \uB530\uB77C \uAC00\uACA9\uC774 \uB2EC\uB77C\uC9C8 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
      '',
      '## \uBB38\uC758 \uC804 \uC9C8\uBB38',
      '- \uCD9C\uBC1C \uAC00\uB2A5\uC77C\uC740 \uC5B8\uC81C\uC778\uAC00\uC694?',
    ].join('\\n');
    const report = inspectBlogIntentQuality({
      title: '\uBD80\uC0B0\uCD9C\uBC1C \uB098\uD2B8\uB791 \uD328\uD0A4\uC9C0',
      primaryKeyword: '\uB098\uD2B8\uB791 \uD328\uD0A4\uC9C0',
      category: 'product',
      contentType: 'package_intro',
      productId: 'pkg_789',
      blogHtml: html,
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain('missing_product_consult_block');
  });
});
