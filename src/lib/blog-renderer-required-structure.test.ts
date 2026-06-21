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
});
