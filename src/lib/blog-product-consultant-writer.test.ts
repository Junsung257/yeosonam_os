import { describe, expect, it } from 'vitest';

import { buildProductBlogBrief } from './blog-product-brief';
import { generateProductConsultantBlogPost } from './blog-product-consultant-writer';

describe('blog product consultant writer', () => {
  it('generates customer-readable decision sections for product blog quality gates', () => {
    const product = {
      id: '11111111-1111-1111-1111-111111111111',
      title: '다낭 3박5일 패키지',
      destination: '다낭',
      duration: 5,
      price_dates: [{ date: '2026-07-18', price: 599000 }],
      departure_airport: '부산',
      airline: '7C',
      inclusions: ['왕복항공', '호텔', '차량'],
      excludes: ['개인경비', '선택관광'],
      itinerary: ['부산 출발', '호이안 관광', '다낭 자유시간', '바나힐', '부산 도착'],
    };
    const brief = buildProductBlogBrief(product, 'value');
    const markdown = generateProductConsultantBlogPost(product, brief);

    expect(markdown).toContain('## 10초 판단');
    expect(markdown).toContain('## 포함/불포함');
    expect(markdown).toContain('## 이런 분께 맞고, 맞지 않을 수 있는 사람');
    expect(markdown).toContain('### 문의 전 질문');
    expect(markdown).toContain('## 자주 묻는 질문?');
    expect(markdown).toContain('599,000원부터');
    expect((markdown.match(/^##\s+/gm) || []).length).toBeLessThanOrEqual(6);
    expect(markdown).not.toMatch(/[�]|諛|愿|怨좉|媛/);
  });

  it('uses the public canonical origin even when local env leaks into the process', () => {
    const previousBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    const previousCanonicalOrigin = process.env.BLOG_CANONICAL_ORIGIN;
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
    delete process.env.BLOG_CANONICAL_ORIGIN;

    try {
      const product = {
        id: '22222222-2222-2222-2222-222222222222',
        title: '?ㅻ궘 3諛????⑦궎吏',
        destination: '?ㅻ궘',
        duration: 5,
        price_dates: [{ date: '2026-07-18', price: 599000 }],
        departure_airport: '遺??',
        airline: '7C',
        inclusions: ['?뺣났??났'],
        excludes: ['媛쒖씤寃쎈퉬'],
        itinerary: ['遺??異쒕컻'],
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
