import { describe, expect, it } from 'vitest';
import { resolveLpHeroPhotoUrl } from './lp-hero-resolver';

describe('resolveLpHeroPhotoUrl', () => {
  it('prioritizes destination-specific attraction photos over generic matched photos', async () => {
    const rows = [
      {
        id: 'generic',
        name: '장백폭포',
        country: 'CN',
        region: '백두산',
        photos: [
          {
            src_large: 'https://example.com/generic.jpg',
            alt: 'Close-up of a traveler activating eSIM on a smartphone over luggage.',
          },
        ],
      },
      {
        id: 'heaven-lake',
        name: '백두산 천지',
        country: 'CN',
        region: '백두산',
        photos: [
          {
            src_large: 'https://example.com/heaven-lake.jpg',
            alt: 'Heaven Lake on Changbai Mountain.',
          },
        ],
      },
    ];
    const sb = {
      from: () => ({
        select: () => ({
          in: async () => ({ data: rows }),
        }),
      }),
    };

    const url = await resolveLpHeroPhotoUrl(sb as never, {
      destination: '연길/백두산',
      itinerary_data: {
        days: [
          {
            schedule: [
              { attraction_ids: ['generic'] },
              { attraction_ids: ['heaven-lake'] },
            ],
          },
        ],
      },
    });

    expect(url).toBe('https://example.com/heaven-lake.jpg');
  });
});
