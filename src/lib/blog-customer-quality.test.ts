import { describe, expect, it } from 'vitest';
import { inspectBlogCustomerQuality } from './blog-customer-quality';

describe('inspectBlogCustomerQuality', () => {
  it('blocks generic info openings that sound like reusable AI scaffolding', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '발리 식비 예산',
      destination: '발리',
      blogHtml: [
        '# 발리 여행 가이드 2026 | 예산과 실제 비용 체크',
        '',
        '답부터 말하면, 2026년 7월 기준 발리에서 먼저 볼 것은 예산 범위, 이동 순서, 현지 확인 사항입니다. 포함/불포함, 이동 시간, 현지 추가비용을 함께 비교하면 불필요한 이동과 추가 부담을 줄일 수 있습니다.',
        '',
        '## 핵심 요약',
        '',
        '- 발리 하루 식비는 1인 기준 25,000원 - 80,000원입니다.',
        '- 와룽은 한 끼 5,000원 안팎입니다.',
        '',
        '## 항목별 예산',
        '',
        '| 구분 | 금액 | 메모 |',
        '| --- | --- | --- |',
        '| 와룽 | 5,000원 | 현금 준비 |',
        '| 레스토랑 | 20,000원 | 세금 확인 |',
        '| 비치클럽 | 50,000원 | 서비스 차지 확인 |',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('generic_answer_opening');
  });

  it('blocks product copy with duplicate price suffix and repeated consultation fallback', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'product',
      productId: 'pkg-1',
      destination: '광저우',
      blogHtml: [
        '# 부산/김해출발 광저우 4박6일 패키지',
        '',
        '1,369,000원부터부터 보이는 광저우 4박 6일 상품은 출발지와 일정 강도에 따라 체감 가치가 달라집니다.',
        '',
        '## 10초 판단',
        '| 확인 항목 | 현재 기준 | 문의 때 볼 점 |',
        '| --- | --- | --- |',
        '| 가격 | 1,369,000원부터 | 상담에서 최종 확인 |',
        '| 출발 | 부산/김해 | 상담에서 최종 확인 |',
        '| 기간 | 4박6일 | 상담에서 최종 확인 |',
        '',
        '## 포함/불포함',
        '| 구분 | 항목 | 확인 포인트 |',
        '| --- | --- | --- |',
        '| 포함 | 왕복항공 | 상담에서 최종 확인 |',
        '| 포함 | 호텔 | 상담에서 최종 확인 |',
        '| 불포함 | 개인경비 | 상담에서 최종 확인 |',
        '',
        '## 문의 전 질문',
        '- 출발일과 인원을 확인합니다.',
      ].join('\n'),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['product_price_suffix_duplicate', 'product_consult_repetition']),
    );
  });

  it('passes a concrete customer-first info guide', () => {
    const report = inspectBlogCustomerQuality({
      blogType: 'info',
      primaryKeyword: '몽골 7월 날씨',
      destination: '몽골',
      blogHtml: [
        '# 몽골 7월 날씨와 옷차림',
        '',
        '몽골 7월 여행은 낮 25도 안팎, 밤 10도 안팎의 일교차를 기준으로 준비하면 안전합니다. 얇은 긴팔, 방수 바람막이, 밤용 플리스 1벌을 나눠 챙기는 편이 가장 실용적입니다.',
        '',
        '## 상황별 옷차림',
        '',
        '| 상황 | 챙길 옷 | 이유 |',
        '| --- | --- | --- |',
        '| 낮 이동 | 얇은 긴팔 | 자외선과 바람 대응 |',
        '| 밤 별보기 | 플리스 또는 경량 패딩 | 체감온도 하락 |',
        '| 소나기 | 방수 바람막이 | 짧은 비 대응 |',
        '',
        '## 출발 전 확인',
        '',
        '- 외교부 해외안전여행과 항공사 수하물 규정을 확인합니다.',
      ].join('\n'),
    });

    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
  });
});
