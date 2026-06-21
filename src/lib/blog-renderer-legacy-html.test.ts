import { describe, expect, it } from 'vitest';
import { renderBlogContentToHtml } from './blog-renderer';

describe('blog renderer legacy HTML cleanup', () => {
  it('recovers inline headings from decorative strong legacy HTML paragraphs', async () => {
    const longTips = [
      '현지 여행 경비를 효과적으로 절약하면서도 실용적인 여행을 즐길 수 있는 몇 가지 팁입니다.',
      '1.항공권은 발권 시기 조절: 2개월 전 미리 예약하고 주중 출발을 확인하세요.',
      '2.숙소는 가성비 위주로: 위치와 청결도를 우선으로 비교하세요.',
      '3.식사는 현지 맛집 활용: 시장과 작은 식당을 함께 확인하세요.',
      '4.대중교통 적극 이용: 앱 호출 택시와 지하철을 함께 비교하세요.',
      '5.패키지 상품 활용 고려: 이동과 예약 부담이 크면 상품 조건을 확인하세요.',
    ].join(' ').repeat(3);
    const source = [
      '<h2>석가장 여행 비용</h2>',
      '<p><strong>데이터가 부족한 항목은 단정하기 어려우니, 정확한 최신 정보는 <a href="https://www.yeosonam.com/">여소남 큐레이터에게 문의</a>하여 확인하는 것이 가장 좋습니다.## 현지 여행 경비, 이렇게 절약해 보세요! ',
      longTips,
      '</strong></p>',
    ].join('');

    const html = await renderBlogContentToHtml(source);

    expect(html).toContain('<h2>현지 여행 경비, 이렇게 절약해 보세요!</h2>');
    expect(html).toContain('<ul><li>항공권은 발권 시기 조절:');
    expect(html).not.toContain('좋습니다.## 현지');
    expect(html).not.toContain(`<p>${longTips}</p>`);
    expect((html.match(/<li>/g) || []).length).toBeGreaterThanOrEqual(5);
  });
});
