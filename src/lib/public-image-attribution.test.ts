import { describe, expect, it } from 'vitest';

import { findPublicHeroAttribution, publicImageAttributionLabel } from './public-image-attribution';

describe('public image attribution', () => {
  const approved = {
    url: 'https://cdn.example.com/clark.jpg',
    source: 'approved_destination',
    photographer: 'Juan dela Cruz',
    provider: 'wikimedia_commons',
    source_page_url: 'https://commons.wikimedia.org/wiki/File:Clark.jpg',
    license: 'CC BY-SA 4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  };

  it('returns attribution only for the exact current approved hero', () => {
    const result = findPublicHeroAttribution([approved], approved.url);
    expect(result).toMatchObject({ photographer: 'Juan dela Cruz', license: 'CC BY-SA 4.0' });
    expect(publicImageAttributionLabel(result!)).toBe(
      'Juan dela Cruz · Wikimedia Commons · CC BY-SA 4.0',
    );
  });

  it('does not attach a credit to another image', () => {
    expect(findPublicHeroAttribution([approved], 'https://cdn.example.com/other.jpg')).toBeNull();
  });

  it('rejects missing or unsafe attribution links', () => {
    expect(findPublicHeroAttribution([{ ...approved, source_page_url: 'javascript:alert(1)' }], approved.url))
      .toBeNull();
  });
});
