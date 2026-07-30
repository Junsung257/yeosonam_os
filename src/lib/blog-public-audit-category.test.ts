import { describe, expect, it } from 'vitest';
import { resolvePublicBlogAuditCategory } from './blog-public-audit-category';

describe('resolvePublicBlogAuditCategory', () => {
  it('recovers an information intent when the public category is missing', () => {
    expect(resolvePublicBlogAuditCategory({
      title: '두바이 7월 날씨 옷차림 여행 준비물 체크리스트',
      destination: '두바이',
      contentType: 'guide',
      expectedType: 'info',
    })).toBe('monthly_weather');
  });

  it('preserves a meaningful declared category for unclassified legacy posts', () => {
    expect(resolvePublicBlogAuditCategory({
      title: '처음 가는 여행 준비 안내',
      category: 'beginner_guide',
      contentType: 'guide',
      expectedType: 'info',
    })).toBe('beginner_guide');
  });

  it('keeps product-backed posts separate from informational categories', () => {
    expect(resolvePublicBlogAuditCategory({
      title: '세부 패키지 선택 기준',
      contentType: 'package_intro',
      expectedType: 'product',
    })).toBe('product:package_intro');
  });
});
