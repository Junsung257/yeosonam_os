import { describe, expect, it } from 'vitest';

import { evaluateDestinationMediaAutoApproval } from './destination-media-auto-approval';

const candidate = {
  destination: '오사카',
  hero_image_url: 'https://example.supabase.co/storage/v1/object/public/destination-photos/destination-aabbccddeeff001122334455/hero-wikimedia_commons.jpg',
  hero_image_provider: 'wikimedia_commons',
  hero_image_source_page_url: 'https://commons.wikimedia.org/wiki/File:View_of_Osaka_castle.jpg',
  hero_image_source_file_title: 'File:View of Osaka castle.jpg',
  hero_image_license: 'CC BY-SA 4.0',
  hero_image_license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  hero_photographer: 'Bongsub Kim',
  hero_image_alt: '일본 오사카성 전경',
};

describe('destination media auto approval', () => {
  it('approves only a complete, identity-matched, verified stored binary', () => {
    expect(evaluateDestinationMediaAutoApproval(candidate, {
      binaryVerified: true,
      checkedAt: '2026-07-31T00:00:00.000Z',
    })).toMatchObject({ approved: true, score: 1 });
  });

  it('blocks a top search result for the wrong destination', () => {
    expect(evaluateDestinationMediaAutoApproval({
      ...candidate,
      destination: '괌',
      hero_image_alt: '괌 여행 이미지',
    }, {
      binaryVerified: true,
      checkedAt: '2026-07-31T00:00:00.000Z',
    })).toMatchObject({ approved: false, reason: 'source file title lacks a reviewed destination identity term' });
  });

  it('blocks when the stored binary is unavailable', () => {
    expect(evaluateDestinationMediaAutoApproval(candidate, {
      binaryVerified: false,
      checkedAt: '2026-07-31T00:00:00.000Z',
    })).toMatchObject({ approved: false, reason: 'stored image binary could not be verified' });
  });
});
