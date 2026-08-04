import { describe, expect, it } from 'vitest';

import {
  evaluateBlogGeneratedQualityCanary,
  evaluateBlogGeneratedQualityCanaryReport,
} from './blog-canary-generated-quality';
import { buildProductBlogBrief } from './blog-product-brief';
import { generateProductConsultantBlogPost } from './blog-product-consultant-writer';

describe('evaluateBlogGeneratedQualityCanary', () => {
  it('passes product writer output only when engine, customer, and render contracts are all clean', async () => {
    const product = {
      id: '33333333-3333-3333-3333-333333333333',
      title: 'Nha Trang 3-night package',
      destination: 'Nha Trang',
      duration: 5,
      price_dates: [{ date: '2026-07-18', price: 599000 }],
      departure_airport: 'Busan',
      airline: '7C',
      inclusions: ['round-trip flight', 'hotel', 'local transfer'],
      excludes: ['personal expenses', 'optional tours'],
      itinerary: ['Busan departure', 'Nha Trang arrival', 'free time', 'city transfer', 'Busan arrival'],
    };
    const brief = buildProductBlogBrief(product, 'value');
    const markdown = generateProductConsultantBlogPost(product, brief);

    const result = await evaluateBlogGeneratedQualityCanary({
      markdown,
      title: product.title,
      slug: 'nhatrang-product-canary',
      destination: product.destination,
      primaryKeyword: 'Nha Trang 5-day package',
      contentType: 'package_intro',
      productId: product.id,
      generationMeta: {
        writer: 'product_consultant_writer',
        product_consult_brief: brief,
        content_brief: { evidence: ['product_db'] },
      },
    });

    expect(result.status).toBe('pass');
    expect(result.score).toBe(100);
    expect(result.failure_reasons).toEqual([]);
  });

  it('fails generated posts that still contain broken markdown tables or weak customer copy', async () => {
    const markdown = [
      '# broken canary',
      '',
      'This draft says book now before checking the reader task, and it does not answer the travel question first.',
      '',
      '| column | value |',
      '| row without separator | value |',
      '',
      '**',
    ].join('\n');

    const result = await evaluateBlogGeneratedQualityCanary({
      markdown,
      title: 'broken canary',
      slug: 'broken-canary',
      destination: 'Bali',
      primaryKeyword: 'Bali weather',
      generationMeta: { writer: 'info_writer' },
    });

    expect(result.status).toBe('fail');
    expect(result.score).toBeLessThan(100);
    expect(result.failure_reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^engine\./),
        expect.stringMatching(/^customer\./),
        expect.stringMatching(/^render\./),
      ]),
    );
  });

  it('summarizes generated canary samples for diagnostics', async () => {
    const product = {
      id: '44444444-4444-4444-4444-444444444444',
      title: 'Bali 3-night package',
      destination: 'Bali',
      duration: 4,
      price_dates: [{ date: '2026-08-01', price: 899000 }],
      departure_airport: 'Busan',
      airline: 'KE',
      inclusions: ['round-trip flight', 'hotel', 'local transfer'],
      excludes: ['personal expenses', 'optional tours'],
      itinerary: ['Busan departure', 'Bali arrival', 'main sightseeing', 'Busan arrival'],
    };
    const brief = buildProductBlogBrief(product, 'value');
    const markdown = generateProductConsultantBlogPost(product, brief);

    const report = await evaluateBlogGeneratedQualityCanaryReport({
      requested: 1,
      posts: [{
        id: product.id,
        slug: 'bali-product-canary',
        seo_title: product.title,
        blog_html: markdown,
        destination: product.destination,
        primary_keyword: 'Bali 4-day package',
        content_type: 'package_intro',
        product_id: product.id,
        generation_meta: {
          writer: 'product_consultant_writer',
          product_consult_brief: brief,
          content_brief: { evidence: ['product_db'] },
        },
      }],
    });

    expect(report.status).toBe('pass');
    expect(report.pass_count).toBe(1);
    expect(report.samples[0]).toMatchObject({
      slug: 'bali-product-canary',
      writer_type: 'product_consultant_writer',
      status: 'pass',
      score: 100,
    });
  });

  it('prefers a mixed info/product generated canary sample when both writer outputs exist', async () => {
    const product = {
      id: '55555555-5555-5555-5555-555555555555',
      title: 'Bali 3-night package',
      destination: 'Bali',
      duration: 4,
      price_dates: [{ date: '2026-08-01', price: 899000 }],
      departure_airport: 'Busan',
      airline: 'KE',
      inclusions: ['round-trip flight', 'hotel', 'local transfer'],
      excludes: ['personal expenses', 'optional tours'],
      itinerary: ['Busan departure', 'Bali arrival', 'main sightseeing', 'Busan arrival'],
    };
    const brief = buildProductBlogBrief(product, 'value');
    const productMarkdown = generateProductConsultantBlogPost(product, brief);
    const infoMarkdown = [
      '# Bali rainy season packing checklist',
      '',
      'Bali rainy season packing starts with a light rain jacket, quick-dry clothing, and waterproof storage because short showers can change walking and transfer plans quickly.',
      '',
      '## Packing table',
      '',
      '| Situation | Pack first | Why it matters |',
      '| --- | --- | --- |',
      '| Short shower | light rain jacket | keeps transfers easier |',
      '| Beach day | quick-dry shirt | dries faster after rain |',
      '| Documents | waterproof pouch | protects passport and tickets |',
      '',
      '## Official checks',
      '',
      '- [Travel safety check](https://www.0404.go.kr/)',
      '',
      '### Check by your schedule',
      '',
      '- [Review Bali package conditions](https://www.yeosonam.com/blog/bali-weather-packing?utm=blog_bottom)',
    ].join('\n');

    const report = await evaluateBlogGeneratedQualityCanaryReport({
      requested: 2,
      posts: [
        {
          slug: 'bali-info-canary',
          seo_title: 'Bali rainy season packing checklist',
          blog_html: infoMarkdown,
          destination: 'Bali',
          generation_meta: {
            writer: 'info_writer',
            info_guide_brief: { official_sources_required: true },
            content_brief: { search_intent: 'weather', evidence: ['rain packing'] },
          },
        },
        {
          slug: 'bali-product-canary',
          seo_title: product.title,
          blog_html: productMarkdown,
          destination: product.destination,
          content_type: 'package_intro',
          product_id: product.id,
          generation_meta: {
            writer: 'product_consultant_writer',
            product_consult_brief: brief,
            content_brief: { evidence: ['product_db'] },
          },
        },
      ],
    });

    expect(report.samples.map((sample) => sample.writer_type)).toEqual([
      'info_writer',
      'product_consultant_writer',
    ]);
  });

  it('warns when recent rows do not include enough body content for generated canary proof', async () => {
    const report = await evaluateBlogGeneratedQualityCanaryReport({
      requested: 2,
      posts: [{ slug: 'metadata-only', blog_html: null }],
    });

    expect(report.status).toBe('warn');
    expect(report.checked_count).toBe(0);
    expect(report.next_action).toContain('body content');
  });

  it('warns when generated proof has only one writer path', async () => {
    const product = {
      id: '66666666-6666-6666-6666-666666666666',
      title: 'Bali 3-night package',
      destination: 'Bali',
      duration: 4,
      price_dates: [{ date: '2026-08-01', price: 899000 }],
      departure_airport: 'Busan',
      airline: 'KE',
      inclusions: ['round-trip flight', 'hotel', 'local transfer'],
      excludes: ['personal expenses', 'optional tours'],
      itinerary: ['Busan departure', 'Bali arrival', 'main sightseeing', 'Busan arrival'],
    };
    const brief = buildProductBlogBrief(product, 'value');
    const markdown = generateProductConsultantBlogPost(product, brief);
    const report = await evaluateBlogGeneratedQualityCanaryReport({
      requested: 2,
      posts: [
        {
          slug: 'bali-product-canary-1',
          seo_title: product.title,
          blog_html: markdown,
          destination: product.destination,
          content_type: 'package_intro',
          product_id: product.id,
          generation_meta: {
            writer: 'product_consultant_writer',
            product_consult_brief: brief,
            content_brief: { evidence: ['product_db'] },
          },
        },
        {
          slug: 'bali-product-canary-2',
          seo_title: product.title,
          blog_html: markdown,
          destination: product.destination,
          content_type: 'package_intro',
          product_id: product.id,
          generation_meta: {
            writer: 'product_consultant_writer',
            product_consult_brief: brief,
            content_brief: { evidence: ['product_db'] },
          },
        },
      ],
    });

    expect(report.status).toBe('warn');
    expect(report.next_action).toContain('product-consultant');
  });

  it('surfaces fleet phrase drift warnings when individual samples pass', async () => {
    const products = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        title: 'Bali 3-night package',
        destination: 'Bali',
        duration: 4,
        price_dates: [{ date: '2026-08-01', price: 899000 }],
        departure_airport: 'Busan',
        airline: 'KE',
        inclusions: ['round-trip flight', 'hotel', 'local transfer'],
        excludes: ['personal expenses', 'optional tours'],
        itinerary: ['Busan departure', 'Bali arrival', 'main sightseeing', 'Busan arrival'],
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        title: 'Cebu 4-night package',
        destination: 'Cebu',
        duration: 5,
        price_dates: [{ date: '2026-08-01', price: 699000 }],
        departure_airport: 'Busan',
        airline: '7C',
        inclusions: ['round-trip flight', 'hotel', 'local transfer'],
        excludes: ['personal expenses', 'optional tours'],
        itinerary: ['Busan departure', 'Cebu arrival', 'island hopping', 'Busan arrival'],
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        title: 'Nha Trang 3-night package',
        destination: 'Nha Trang',
        duration: 5,
        price_dates: [{ date: '2026-08-01', price: 599000 }],
        departure_airport: 'Busan',
        airline: 'BX',
        inclusions: ['round-trip flight', 'hotel', 'local transfer'],
        excludes: ['personal expenses', 'optional tours'],
        itinerary: ['Busan departure', 'Nha Trang arrival', 'free day', 'Busan arrival'],
      },
    ];

    const report = await evaluateBlogGeneratedQualityCanaryReport({
      requested: 3,
      writerMixRequired: false,
      posts: products.map((product) => {
        const brief = buildProductBlogBrief(product, 'value');
        return {
          slug: product.id,
          seo_title: product.title,
          blog_html: generateProductConsultantBlogPost(product, brief),
          destination: product.destination,
          content_type: 'package_intro',
          product_id: product.id,
          generation_meta: {
            writer: 'product_consultant_writer',
            product_consult_brief: brief,
            content_brief: { evidence: ['product_db'] },
          },
        };
      }),
    });

    expect(report.status).toBe('warn');
    expect(report.fail_count).toBe(0);
    expect(report.fleet_phrase_drift.status).toBe('warn');
    expect(report.next_action).toContain('repeated openings');
  });

  it('checks the full recent body pool for fleet drift instead of only scored samples', async () => {
    const markdown = [
      '# Destination weather guide',
      '',
      'This guide answers the month, packing, and transfer questions before departure so the reader can make a practical plan.',
      '',
      '## Monthly conditions',
      '',
      'Review the monthly range and rainfall pattern.',
      '',
      '## What to pack',
      '',
      'Use layers and a compact rain shell.',
      '',
      '## Transport notes',
      '',
      'Leave extra transfer time when showers are likely.',
      '',
      '## Official checks',
      '',
      'Confirm the latest notice before leaving.',
    ].join('\n');

    const report = await evaluateBlogGeneratedQualityCanaryReport({
      requested: 1,
      writerMixRequired: false,
      posts: ['a', 'b', 'c', 'd'].map((slug) => ({ slug, blog_html: markdown })),
    });

    expect(report.checked_count).toBe(1);
    expect(report.fleet_phrase_drift.checked_count).toBe(4);
    expect(report.fleet_phrase_drift.status).toBe('block');
  });
});
