import { describe, expect, it } from 'vitest';
import { classifyBlogIntent, inspectBlogIntentQuality } from './blog-content-intent';

describe('blog content intent quality', () => {
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
});
