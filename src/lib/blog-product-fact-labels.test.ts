import { describe, expect, it } from 'vitest';
import { buildBlogProductFactLabels } from './blog-product-fact-labels';

describe('blog product fact labels', () => {
  it('uses only persisted package facts', () => {
    expect(buildBlogProductFactLabels({
      airline: 'BX',
      departureAirport: 'PUS (김해)',
      duration: '3',
      nights: 2,
    })).toEqual(['BX 항공', 'PUS 출발', '2박 3일']);
  });

  it('does not invent trust claims when facts are missing', () => {
    const labels = buildBlogProductFactLabels({});
    expect(labels).toEqual([]);
    expect(labels.join(' ')).not.toMatch(/운영팀|검증|직항|노팁|노옵션/);
  });

  it('rejects implausible numeric durations and de-duplicates labels', () => {
    expect(buildBlogProductFactLabels({ duration: 365, nights: 364 })).toEqual([]);
  });
});
