import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INFORMATIONAL_QUEUE_SOURCES, routeBlogContentLane } from './blog-content-boundary';

describe('blog information/product boundary', () => {
  it.each(INFORMATIONAL_QUEUE_SOURCES)('routes %s to the information lane without a product', (source) => {
    expect(routeBlogContentLane({ source })).toEqual({ passed: true, lane: 'informational', source });
  });

  it('requires the product source and product id to agree', () => {
    expect(routeBlogContentLane({ source: 'product', productId: 'product-1' }))
      .toMatchObject({ passed: true, lane: 'product' });
    expect(routeBlogContentLane({ source: 'user_seed', productId: 'product-1' }))
      .toMatchObject({ passed: false, issue: 'product_id_requires_product_source' });
    expect(routeBlogContentLane({ source: 'product' }))
      .toMatchObject({ passed: false, issue: 'product_source_requires_product_id' });
  });

  it('keeps card-news bridging separate from both writer lanes', () => {
    expect(routeBlogContentLane({ source: 'card_news', cardNewsId: 'card-1', productId: 'product-1' }))
      .toMatchObject({ passed: true, lane: 'card_news_bridge' });
    expect(routeBlogContentLane({ source: 'card_news' }))
      .toMatchObject({ passed: false, issue: 'card_news_source_requires_card_news_id' });
  });

  it('proves information-only pillar context has no product repository dependency', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/blog-pillar-generator.ts'), 'utf8');
    for (const forbidden of [
      'travel_packages',
      'CUSTOMER_VISIBLE_STATUSES',
      'packageSummary',
      'priceRange',
      '활성 패키지',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('keeps the information writer segment free of product-only repositories and builders', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/cron/blog-publisher/route.ts'), 'utf8');
    const start = route.indexOf('async function generateFromTopic');
    const end = route.indexOf('\nasync function ', start + 1);
    const segment = route.slice(start, end > start ? end : undefined);

    expect(start).toBeGreaterThan(0);
    for (const forbidden of [
      "from('travel_packages')",
      'loadCustomerOpenContractForPackage',
      'buildProductBlogBrief',
      'buildProductConsultBrief',
      'fetchBlogOriginalitySignals',
    ]) {
      expect(segment).not.toContain(forbidden);
    }
  });
});
