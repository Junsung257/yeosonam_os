import { describe, expect, it } from 'vitest';
import { summarizeBlogIndexingCoverage } from './blog-indexing-coverage';

describe('summarizeBlogIndexingCoverage', () => {
  it('treats either content id or canonical slug as outbox coverage', () => {
    const summary = summarizeBlogIndexingCoverage({
      posts: [
        { id: 'post-a', slug: 'bali-family-budget' },
        { id: 'post-b', slug: 'danang-weather-guide' },
      ],
      jobs: [
        { content_creative_id: 'post-a', status: 'succeeded' },
        { url: 'https://www.yeosonam.com/blog/danang-weather-guide', status: 'pending' },
      ],
    });

    expect(summary).toMatchObject({
      checked_count: 2,
      covered_count: 2,
      missing_count: 0,
      coverage_rate: 100,
    });
  });

  it('reports published posts that never reached the indexing outbox', () => {
    const summary = summarizeBlogIndexingCoverage({
      posts: [
        { id: 'post-a', slug: 'bali-family-budget' },
        { id: 'post-b', slug: '/blog/osaka-rainy-season' },
      ],
      jobs: [
        { slug: 'bali-family-budget', status: 'failed' },
      ],
    });

    expect(summary.missing_count).toBe(1);
    expect(summary.missing_slugs).toEqual(['osaka-rainy-season']);
    expect(summary.coverage_rate).toBe(50);
  });
});
