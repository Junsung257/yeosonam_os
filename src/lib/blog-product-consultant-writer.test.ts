import { describe, expect, it } from 'vitest';
import { buildProductBlogBrief } from './blog-product-brief';
import { generateProductConsultantBlogPost } from './blog-product-consultant-writer';

describe('blog product consultant writer', () => {
  it('writes product posts as pre-inquiry decision guides', () => {
    const product = {
      id: 'pkg_bali_family',
      title: '발리 가족 패키지',
      destination: '발리',
      duration: 5,
      price: 899000,
      departure_airport: '인천',
      airline: '대한항공',
      inclusions: ['왕복 항공', '호텔', '가이드'],
      excludes: ['개인경비', '선택관광'],
      itinerary: ['인천 출발 후 발리 도착', '우붓 관광', '리조트 휴식'],
      product_highlights: ['가족 동반 일정', '휴식일 포함'],
    };
    const brief = buildProductBlogBrief(product, 'value');
    const post = generateProductConsultantBlogPost(product, brief);

    expect(post).toContain('10초 판단');
    expect(post).toContain('포함/불포함');
    expect(post).toContain('이런 분께 맞습니다');
    expect(post).toContain('이런 분께는 맞지 않을 수 있습니다');
    expect(post).toContain('가격이 달라질 수 있는 조건');
    expect(post).toContain('문의 전 질문');
    expect(post).toContain('/packages/pkg_bali_family');
    expect(post).toContain('/group-inquiry?');
    expect(post).toContain('writer: product_consultant_writer');
    expect(post).not.toContain('이게 말이 되나 싶으시죠');
    expect(post).not.toContain('완벽 가이드');
  });
});
