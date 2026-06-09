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

2026년 기준 장가계 날씨는 봄과 가을이 걷기 좋고, 여름은 우기 대응이 핵심입니다.

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
==7월과 8월은 강수량이 높아 천문산 케이블카 대기 시간이 30분 이상 늘 수 있습니다.==

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
});
