import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isSupportedCommonsLicense,
  searchWikimediaCommonsPhotos,
} from './wikimedia-commons';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Wikimedia Commons destination media', () => {
  it('allows only simple commercial-reuse licenses with auditable terms', () => {
    expect(isSupportedCommonsLicense('CC BY 4.0')).toBe(true);
    expect(isSupportedCommonsLicense('CC BY-SA 3.0')).toBe(true);
    expect(isSupportedCommonsLicense('CC BY-SA 3.0 de')).toBe(true);
    expect(isSupportedCommonsLicense('CC0 1.0')).toBe(true);
    expect(isSupportedCommonsLicense('Public domain')).toBe(true);
    expect(isSupportedCommonsLicense('GFDL')).toBe(false);
    expect(isSupportedCommonsLicense('Fair use')).toBe(false);
  });

  it('returns only landscape photos with author, source page, and license evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: [
            {
              pageid: 123,
              title: 'File:Clark panorama.jpg',
              imageinfo: [{
                url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/clark.jpg',
                thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/clark.jpg/1200px-clark.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Clark_panorama.jpg',
                width: 2400,
                height: 1200,
                mime: 'image/jpeg',
                extmetadata: {
                  Artist: { value: '<a href="/wiki/User:Owner">Photo Owner</a>' },
                  LicenseShortName: { value: 'CC BY-SA 4.0' },
                  LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
                  ObjectName: { value: 'Clark panorama' },
                },
              }],
            },
            {
              pageid: 456,
              title: 'File:Portrait.jpg',
              imageinfo: [{
                url: 'https://upload.wikimedia.org/wikipedia/commons/p/portrait.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Portrait.jpg',
                width: 800,
                height: 1200,
                mime: 'image/jpeg',
                extmetadata: {
                  Artist: { value: 'Owner' },
                  LicenseShortName: { value: 'CC BY 4.0' },
                  LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
                },
              }],
            },
          ],
        },
      }),
    }));

    const photos = await searchWikimediaCommonsPhotos('Clark Philippines', 8);

    expect(photos).toHaveLength(1);
    expect(photos[0]).toEqual(expect.objectContaining({
      provider: 'wikimedia_commons',
      asset_id: '123',
      photographer: 'Photo Owner',
      license: 'CC BY-SA 4.0',
      source_file_title: 'File:Clark panorama.jpg',
      src_large: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/clark.jpg/1200px-clark.jpg',
    }));
  });
});
