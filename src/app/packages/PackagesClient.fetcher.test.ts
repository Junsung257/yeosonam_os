import { afterEach, describe, expect, it, vi } from 'vitest';
import { packagesSearchFetcher, PackagesSearchError } from './PackagesClient';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('packagesSearchFetcher', () => {
  it('throws a typed error on failed package search responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'admin boundary denied', code: 'forbidden' }),
      { status: 403 },
    )));

    await expect(packagesSearchFetcher('/api/packages/search'))
      .rejects
      .toMatchObject({
        name: 'PackagesSearchError',
        message: 'admin boundary denied',
        status: 403,
        code: 'forbidden',
      });
  });

  it('rejects malformed successful package search responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: true }),
      { status: 200 },
    )));

    await expect(packagesSearchFetcher('/api/packages/search'))
      .rejects
      .toBeInstanceOf(PackagesSearchError);
  });

  it('returns valid package search payloads', async () => {
    const payload = {
      packages: [],
      total: 0,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

    await expect(packagesSearchFetcher('/api/packages/search')).resolves.toEqual(payload);
  });
});
