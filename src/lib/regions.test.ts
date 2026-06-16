import { describe, expect, it } from 'vitest';

import {
  destinationSlugMatches,
  destinationToSlug,
  encodeDestinationPathSegment,
  getDestinationUrl,
} from './regions';

describe('destination URL slugs', () => {
  it('keeps slash-bearing destination names in one safe path segment', () => {
    expect(destinationToSlug('연길/백두산')).toBe('연길-백두산');
    expect(encodeDestinationPathSegment('연길/백두산')).toBe('%EC%97%B0%EA%B8%B8-%EB%B0%B1%EB%91%90%EC%82%B0');
    expect(getDestinationUrl('연길/백두산')).toBe('/destinations/%EC%97%B0%EA%B8%B8-%EB%B0%B1%EB%91%90%EC%82%B0');
  });

  it('matches canonical slugs back to their display destination', () => {
    expect(destinationSlugMatches('연길/백두산', '연길-백두산')).toBe(true);
    expect(destinationSlugMatches('연길/백두산', '연길/백두산')).toBe(true);
    expect(destinationSlugMatches('클락', '연길-백두산')).toBe(false);
  });
});
