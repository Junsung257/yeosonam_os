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
          in: () => ({
            limit: async () => ({ data: rows }),
          }),
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

  it('falls back to destination-region attraction photos when itinerary has no attraction ids', async () => {
    const rows = [
      {
        id: 'nha-trang-beach',
        name: '나트랑비치',
        country: 'VN',
        region: '나트랑',
        photos: [
          {
            src_large: 'https://example.com/nha-trang-beach.jpg',
            alt: 'Nha Trang beach coastline',
          },
        ],
      },
    ];
    const sb = {
      from: () => ({
        select: () => ({
          not: () => ({
            or: () => ({
              limit: async () => ({ data: rows }),
            }),
          }),
        }),
      }),
    };

    const url = await resolveLpHeroPhotoUrl(sb as never, {
      destination: '나트랑',
      itinerary_data: { days: [{ schedule: [{ activity: '다이아몬드CC 라운딩' }] }] },
    });

    expect(url).toBe('https://example.com/nha-trang-beach.jpg');
  });
});
