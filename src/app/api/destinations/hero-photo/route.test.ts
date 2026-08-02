import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { buildDestinationMediaStoragePath } from '@/lib/destination-media-storage';

const mocks = vi.hoisted(() => ({
  commonsSearch: vi.fn(),
  pexelsSearch: vi.fn(),
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
  dbFrom: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/wikimedia-commons', () => ({
  isSupportedCommonsLicense: vi.fn((license: string) => license === 'CC BY-SA 4.0'),
  searchWikimediaCommonsPhotos: mocks.commonsSearch,
}));

vi.mock('@/lib/pexels', () => ({
  destToEnKeyword: vi.fn((destination: string) => destination),
  isPexelsConfigured: vi.fn(() => true),
  searchPexelsPhotos: mocks.pexelsSearch,
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({
        upload: mocks.upload,
        getPublicUrl: mocks.getPublicUrl,
      })),
    },
    from: mocks.dbFrom,
  },
}));

import { dynamic, GET, POST } from './route';

function request(
  method: 'GET' | 'POST',
  url = 'http://localhost/api/destinations/hero-photo',
  body?: Record<string, unknown>,
  admin = false,
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      ...(admin ? { cookie: 'ys-dev-admin=1' } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function expectPrivateNoStore(response: Response): void {
  expect(response.headers.get('cache-control')).toContain('private');
  expect(response.headers.get('cache-control')).toContain('no-store');
}

describe('/api/destinations/hero-photo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upload.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockReturnValue({
      data: {
        publicUrl: 'https://example.supabase.co/storage/v1/object/public/destination-photos/reviewed.jpg',
      },
    });
    mocks.upsert.mockReturnValue({
      select: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { destination: '삿포로/니세코', photo_approved: false },
          error: null,
        }),
      })),
    });
    mocks.dbFrom.mockImplementation((table: string) => {
      if (table !== 'destination_metadata') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return { upsert: mocks.upsert };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ['GET', GET],
    ['POST', POST],
  ] as const)('rejects unauthenticated %s before search, download, storage, or DB access', async (method, handler) => {
    vi.stubEnv('NODE_ENV', 'production');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await handler(request(method));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: 'UNAUTHORIZED' });
    expectPrivateNoStore(response);
    expect(mocks.commonsSearch).not.toHaveBeenCalled();
    expect(mocks.pexelsSearch).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.dbFrom).not.toHaveBeenCalled();
  });

  it('rejects invalid provider metadata before downloading or writing', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await POST(request('POST', undefined, {
      destination: '괌',
      provider: 'unknown',
      src_large: 'https://upload.wikimedia.org/example.jpg',
      photographer: 'Example',
      source_page_url: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
    }, true));

    expect(response.status).toBe(400);
    expectPrivateNoStore(response);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.dbFrom).not.toHaveBeenCalled();
  });

  it('copies a reviewed Commons file and stores it only as an unapproved candidate', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/example.jpg/1280px-example.jpg';
    const imageResponse = new Response(
      new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      { status: 200, headers: { 'content-type': 'image/jpeg' } },
    );
    Object.defineProperty(imageResponse, 'url', { value: imageUrl });
    const fetchSpy = vi.fn().mockResolvedValue(imageResponse);
    vi.stubGlobal('fetch', fetchSpy);

    const response = await POST(request('POST', undefined, {
      destination: '삿포로/니세코',
      provider: 'wikimedia_commons',
      asset_id: 'File:Example.jpg',
      src_large: imageUrl,
      photographer: 'Example Author',
      source_page_url: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
      source_file_title: 'File:Example.jpg',
      license: 'CC BY-SA 4.0',
      license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      alt: '니세코 설경',
    }, true));

    expect(response.status).toBe(200);
    expect(dynamic).toBe('force-dynamic');
    expectPrivateNoStore(response);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(mocks.upload).toHaveBeenCalledWith(
      buildDestinationMediaStoragePath({
        destination: '삿포로/니세코',
        provider: 'wikimedia_commons',
        extension: 'jpg',
      }),
      expect.any(Uint8Array),
      { contentType: 'image/jpeg', upsert: true },
    );
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: '삿포로/니세코',
        hero_image_provider: 'wikimedia_commons',
        hero_image_source_file_title: 'File:Example.jpg',
        hero_image_license: 'CC BY-SA 4.0',
        photo_approved: false,
        photo_approved_at: null,
      }),
      { onConflict: 'destination' },
    );
    expect(mocks.dbFrom).toHaveBeenCalledTimes(1);
    expect(mocks.dbFrom).toHaveBeenCalledWith('destination_metadata');
  });
});
