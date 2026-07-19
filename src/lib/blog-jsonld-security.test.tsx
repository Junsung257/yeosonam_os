import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildBlogPostPageJsonLd } from '@/lib/blog-jsonld';
import { serializeJsonLdForScript } from '@/lib/json-ld';

const closingScript = '</script><script>alert(1)</script>';

describe('blog JSON-LD hostile input handling', () => {
  it('bounds schema values, rejects unsafe URLs, and emits inert scripts', () => {
    const bundle = buildBlogPostPageJsonLd({
      baseUrl: 'https://www.yeosonam.com',
      pageUrl: 'javascript:alert(1)',
      title: `${closingScript}${'가'.repeat(200)}`,
      description: `<img src=x onerror=alert(1)> & <!--${'나'.repeat(600)}`,
      publishedAt: '2026-07-15T00:00:00.000Z',
      modifiedAt: null,
      ogImageUrl: 'data:text/html,<script>alert(1)</script>',
      blogHtmlMarkdown: `## 자주 묻는 질문\n\n**Q. ${closingScript}?**\n\nA. <!-- 답변 ${closingScript}\n\n## Day 1 - ${closingScript}\n일정 설명\u2028${closingScript}\u2029\n\n## Day 2 - 둘째 날\n설명\n\n## Day 3 - 셋째 날\n설명`,
      bodyHtmlForWordCount: '<p>본문</p>',
      readingMinutes: Number.POSITIVE_INFINITY,
      angleLabel: `${closingScript}${'다'.repeat(100)}`,
      pkg: {
        id: 'javascript:alert(1)/../../escape',
        title: `${closingScript} 상품`,
        destination: `${closingScript} 오사카`,
        price: Number.POSITIVE_INFINITY,
      },
      durationStr: `${closingScript} 3박4일`,
      productDurationDays: 4,
    });

    expect(String(bundle.blogPosting.headline).length).toBeLessThanOrEqual(110);
    expect(String(bundle.blogPosting.description).length).toBeLessThanOrEqual(500);
    expect(bundle.blogPosting.mainEntityOfPage).toMatchObject({
      '@id': 'https://www.yeosonam.com/blog',
    });
    expect(bundle.blogPosting.image).toBe('https://www.yeosonam.com/og-image.png');
    expect(JSON.stringify(bundle.product)).not.toContain('javascript:alert(1)/../../escape');

    const values = Object.values(bundle).filter((value) => value !== null);
    const html = renderToStaticMarkup(
      <>{values.map((value, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLdForScript(value) }}
        />
      ))}</>,
    );

    expect(html).not.toContain('</script><script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<!--');
    expect(html).not.toContain('\u2028');
    expect(html).not.toContain('\u2029');
  });
});
