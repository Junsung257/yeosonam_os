import { describe, expect, it } from 'vitest';

import { checkArticleQualityV2 } from './blog-quality-gate';
import { inspectRenderedBlogIntegrity, renderBlogContentToHtml } from './blog-renderer';
import { buildProductBlogBrief } from './blog-product-brief';
import { generateProductConsultantBlogPost } from './blog-product-consultant-writer';

describe('blog product consultant writer', () => {
  it('generates customer-readable decision sections for product blog quality gates', async () => {
    const product = {
      id: '11111111-1111-1111-1111-111111111111',
      title: '나트랑 3박5일 패키지',
      destination: '나트랑',
      duration: 5,
      price_dates: [{ date: '2026-07-18', price: 599000 }],
      departure_airport: '부산',
      airline: '7C',
      inclusions: ['왕복항공', '호텔', '차량'],
      excludes: ['개인경비', '선택관광'],
      itinerary: ['부산 출발', '나트랑 관광', '나트랑 자유시간', '시내 이동', '부산 도착'],
    };
    const brief = buildProductBlogBrief(product, 'value');
    const markdown = generateProductConsultantBlogPost(product, brief);

    expect(markdown).toContain('## 10초 판단');
    expect(markdown).toContain('## 포함/불포함');
    expect(markdown).toContain('## 맞는 사람과 안 맞는 사람');
    expect(markdown).toContain('## 문의 전 질문');
    expect(markdown).toContain('## 자주 묻는 질문');
    expect(markdown).not.toContain('상담에서 최종 확인');
    expect(markdown).not.toContain('이게 말이 되나 싶으시죠');
    expect(markdown).toContain('599,000원~');
    expect(markdown).toMatch(/부산 출발 나트랑/);
    expect((markdown.match(/^##\s+/gm) || []).length).toBeLessThanOrEqual(8);

    const articleGate = checkArticleQualityV2({
      slug: 'nhatrang-product-test',
      blog_html: markdown,
      primary_keyword: '나트랑 5일 패키지',
      destination: '나트랑',
      category: 'package',
      angle_type: 'value',
      content_type: 'package_intro',
      blog_type: 'product',
      product_id: product.id,
      generation_meta: {
        writer: 'product_consultant_writer',
        product_consult_brief: brief,
        content_brief: { evidence: ['product_db'] },
      },
    });

    const rendered = await renderBlogContentToHtml(markdown);
    const renderReport = inspectRenderedBlogIntegrity(markdown, rendered);

    expect(articleGate.passed).toBe(true);
    expect(renderReport.passed).toBe(true);
  });

  it('uses the public canonical origin even when local env leaks into the process', () => {
    const previousBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    const previousCanonicalOrigin = process.env.BLOG_CANONICAL_ORIGIN;
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
    delete process.env.BLOG_CANONICAL_ORIGIN;

    try {
      const product = {
        id: '22222222-2222-2222-2222-222222222222',
        title: '나트랑 3박5일 패키지',
        destination: '나트랑',
        duration: 5,
        price_dates: [{ date: '2026-07-18', price: 599000 }],
        departure_airport: '부산',
        airline: '7C',
        inclusions: ['왕복항공'],
        excludes: ['개인경비'],
        itinerary: ['부산 출발'],
      };
      const brief = buildProductBlogBrief(product, 'value');
      const markdown = generateProductConsultantBlogPost(product, brief);

      expect(markdown).not.toContain('localhost:3000');
      expect(markdown).toContain('https://www.yeosonam.com/packages/22222222-2222-2222-2222-222222222222');
      expect(markdown).toContain('https://www.yeosonam.com/group-inquiry');
    } finally {
      if (previousBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
      else process.env.NEXT_PUBLIC_BASE_URL = previousBaseUrl;
      if (previousCanonicalOrigin === undefined) delete process.env.BLOG_CANONICAL_ORIGIN;
      else process.env.BLOG_CANONICAL_ORIGIN = previousCanonicalOrigin;
    }
  });
});
