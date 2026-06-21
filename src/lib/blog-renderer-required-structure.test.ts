import { describe, expect, it } from 'vitest';
import { inspectRenderedBlogIntegrity, renderBlogContentToHtml } from './blog-renderer';

describe('blog renderer required structure', () => {
  it('renders required decision tables for stored weather posts that lack tables', async () => {
    const source = [
      '## 오사카 7월 날씨',
      '',
      '오사카 7월 날씨는 기온, 강수량, 습도 차이를 같이 보고 옷차림과 준비물을 정해야 합니다.',
    ].join('\n');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<table>');
    expect(html).toContain('빠른 판단표');
    expect(html).toContain('기온');
    expect(report.passed).toBe(true);
  });

  it('adds required decision tables to legacy stored HTML posts', async () => {
    const source = [
      '<h2>보라카이 7월 날씨</h2>',
      '<p>보라카이 7월 날씨는 기온, 강수량, 습도 차이를 같이 보고 옷차림과 준비물을 정해야 합니다.</p>',
    ].join('');

    const html = await renderBlogContentToHtml(source);
    const report = inspectRenderedBlogIntegrity(source, html);

    expect(html).toContain('<table>');
    expect(html).toContain('빠른 판단표');
    expect(html).toContain('강수량');
    expect(report.passed).toBe(true);
  });

  it('splits overlong stored HTML paragraphs at render time', async () => {
    const longText = [
      '데이터가 부족한 항목은 단정하기 어려우니, 정확한 최신 정보는 여소남 큐레이터에게 문의하여 확인하는 것이 가장 좋습니다.',
      '현지 여행 경비를 효과적으로 절약하면서도 실용적인 일정을 만들려면 항공, 숙소, 이동, 식비를 따로 보지 말고 함께 비교해야 합니다.',
      '특히 성수기에는 같은 상품이라도 출발일, 항공 시간, 객실 조건에 따라 체감 비용이 크게 달라질 수 있습니다.',
      '예약 전에는 포함 사항과 불포함 사항을 다시 확인하고, 현지에서 추가 결제가 필요한 옵션은 가족 구성원 기준으로 다시 계산하는 편이 안전합니다.',
      '마지막으로 취소 규정과 환불 기준까지 확인하면 출발 직전 일정 변경에도 더 침착하게 대응할 수 있습니다.',
      '숙소 위치와 공항 이동 시간까지 함께 보면 같은 예산에서도 실제 만족도가 달라집니다.',
      '현지 선택 관광은 현장 결제인지 사전 결제인지에 따라 필요한 현금 규모가 달라질 수 있습니다.',
      '아이 또는 부모님과 함께라면 비용보다 이동 피로와 대기 시간을 먼저 줄이는 편이 좋습니다.',
    ].join(' ').repeat(2);
    const source = `<h2>석가장 여행 비용</h2><p>${longText}</p>`;

    const html = await renderBlogContentToHtml(source);

    expect((html.match(/<p>/g) || []).length).toBeGreaterThan(1);
    expect(html).not.toContain(`<p>${longText}</p>`);
  });

  it('recovers inline markdown headings stuck inside stored HTML paragraphs', async () => {
    const source = [
      '<h2>석가장 여행 비용</h2>',
      '<p>데이터가 부족한 항목은 단정하기 어려우니, 정확한 최신 정보는 여소남 큐레이터에게 문의하여 확인하는 것이 가장 좋습니다.## 현지 여행 경비, 이렇게 절약해 보세요! 현지 여행 경비를 효과적으로 절약하면서도 실용적인 여행을 즐길 수 있는 팁입니다.</p>',
    ].join('');

    const html = await renderBlogContentToHtml(source);

    expect(html).toContain('<h2>현지 여행 경비, 이렇게 절약해 보세요!</h2>');
    expect(html).not.toContain('좋습니다.## 현지');
  });
});
