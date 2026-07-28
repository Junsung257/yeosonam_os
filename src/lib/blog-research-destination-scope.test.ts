import { describe, expect, it } from 'vitest';
import { matchesBlogResearchDestinationScope } from './blog-research-destination-scope';

describe('reviewed research document destination scope', () => {
  it('allows a global document with no destination scope', () => {
    expect(matchesBlogResearchDestinationScope({
      destination: '세부',
      scopes: [],
    })).toBe(true);
  });

  it.each([
    ['세부', ['세부', 'cebu']],
    ['Cebu', ['세부', 'cebu']],
    ['코타키나발루', ['코타키나발루']],
    ['코타키나 발루', ['코타키나발루']],
  ])('matches a reviewed destination alias: %s', (destination, scopes) => {
    expect(matchesBlogResearchDestinationScope({ destination, scopes })).toBe(true);
  });

  it('rejects a document reviewed for another destination', () => {
    expect(matchesBlogResearchDestinationScope({
      destination: '세부',
      scopes: ['괌', 'guam'],
    })).toBe(false);
  });

  it('fails closed when a scoped request has no destination', () => {
    expect(matchesBlogResearchDestinationScope({
      destination: '',
      scopes: ['보홀', 'bohol'],
    })).toBe(false);
  });
});
