import { describe, expect, it } from 'vitest';
import { buildMarketingUrl } from './utm';

describe('marketing URL builder', () => {
  it('builds allowlisted Naver blog UTMs on the first-party site', () => {
    const result = buildMarketingUrl({
      destination: '/packages/pkg-1',
      source: 'naver',
      medium: 'blog',
      campaign: 'summer_2026',
      content: 'article_bottom',
    });
    expect(result.isFirstParty).toBe(true);
    expect(result.url).toContain('utm_source=naver');
    expect(result.url).toContain('utm_medium=blog');
  });

  it('rejects arbitrary control characters', () => {
    expect(() => buildMarketingUrl({
      destination: '/packages',
      source: 'naver',
      medium: 'cpc',
      campaign: 'bad\nvalue',
    })).toThrow('Invalid utm_campaign');
  });
});
