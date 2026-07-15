import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INFORMATIONAL_QUEUE_SOURCES, routeBlogContentLane } from './blog-content-boundary';

describe('blog information/product boundary', () => {
  it.each(INFORMATIONAL_QUEUE_SOURCES)('routes %s to the information lane without a product', (source) => {
    expect(routeBlogContentLane({ source })).toEqual({ passed: true, lane: 'informational', source });
  });

  it('routes the product auto-heal regression payload to the existing product lane', () => {
    expect(routeBlogContentLane({
      source: 'auto_heal',
      productId: 'product-1',
      declaredLane: 'product',
    })).toEqual({ passed: true, lane: 'product', source: 'auto_heal' });
  });

  it('keeps information auto-heal in the information lane', () => {
    expect(routeBlogContentLane({
      source: 'auto_heal',
      declaredLane: 'informational',
    })).toEqual({ passed: true, lane: 'informational', source: 'auto_heal' });
  });

  it('rejects a persisted lane that disagrees with the queue identifiers', () => {
    expect(routeBlogContentLane({
      source: 'auto_heal',
      productId: 'product-1',
      declaredLane: 'informational',
    })).toMatchObject({ passed: false, issue: 'declared_lane_mismatch' });
  });

  it('keeps the live gap-healer payload explicitly tied to a product', () => {
    const producer = readFileSync(join(process.cwd(), 'src/lib/content-gap-auto-heal.ts'), 'utf8');

    expect(producer).toContain("source: 'auto_heal'");
    expect(producer).toContain('product_id: gap.id');
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

  it('keeps informational CTA selection and rendering free of product repositories', () => {
    const sources = [
      'src/lib/blog-informational-cta.ts',
      'src/lib/blog-informational-cta-settings.ts',
      'src/components/blog/InformationalCtaHub.tsx',
    ].map((path) => readFileSync(join(process.cwd(), path), 'utf8')).join('\n');

    for (const forbidden of [
      'travel_packages',
      'product_id',
      'package_id',
      'blog-product',
      'product repository',
    ]) {
      expect(sources.toLowerCase()).not.toContain(forbidden);
    }
  });
});
