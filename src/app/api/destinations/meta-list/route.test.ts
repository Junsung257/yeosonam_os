import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseAdmin: {
    from: mocks.from,
  },
}));

import { dynamic, GET, revalidate } from './route';

function request(admin = false): NextRequest {
  return new NextRequest('http://localhost/api/destinations/meta-list', {
    headers: admin ? { cookie: 'ys-dev-admin=1' } : undefined,
  });
}

describe('/api/destinations/meta-list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.mockResolvedValue({
      data: [{
        destination: '괌',
        hero_image_url: 'https://example.supabase.co/reviewed.jpg',
        hero_image_provider: 'wikimedia_commons',
        hero_image_source_page_url: 'https://commons.wikimedia.org/wiki/File:Reviewed.jpg',
        hero_image_source_file_title: 'File:Reviewed.jpg',
        hero_image_license: 'CC BY-SA 4.0',
        hero_image_license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
        hero_photographer: 'Example Author',
        photo_approved: false,
        photo_approved_at: null,
      }],
      error: null,
    });
    mocks.select.mockReturnValue({ order: mocks.order });
    mocks.from.mockReturnValue({ select: mocks.select });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects unauthenticated reads before service-role DB access', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('returns unapproved provenance to an admin without public caching', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    const response = await GET(request(true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(dynamic).toBe('force-dynamic');
    expect(revalidate).toBe(0);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.data).toEqual([
      expect.objectContaining({
        destination: '괌',
        hero_image_provider: 'wikimedia_commons',
        photo_approved: false,
      }),
    ]);
    expect(mocks.from).toHaveBeenCalledWith('destination_metadata');
    expect(mocks.select).toHaveBeenCalledWith(
      expect.stringContaining('hero_image_license_url'),
    );
  });
});
