import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { middleware } from './middleware';

describe('middleware cron resource saver', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('skips trusted Vercel cron invocations before route handlers hit the database', async () => {
    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '1');

    const response = await middleware(new NextRequest('https://www.yeosonam.com/api/cron/meta-optimize', {
      headers: { 'x-vercel-cron': '1' },
    }));

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      skipped: true,
      cron: 'meta-optimize',
      reason: 'db_resource_saver_mode',
    });
  });

  it('also gates blog publisher cron while DB resource saver is active', async () => {
    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '1');

    const response = await middleware(new NextRequest('https://www.yeosonam.com/api/cron/blog-publisher', {
      headers: { 'x-vercel-cron': '1' },
    }));

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      skipped: true,
      cron: 'blog-publisher',
      reason: 'db_resource_saver_mode',
    });
  });

  it('returns a hard noindex tombstone for archived blog slugs', async () => {
    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/blog/july-family-travel-weather-clothes-checklist-2026',
    ));

    expect(response.status).toBe(410);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});

describe('middleware blog API boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['GET', '/api/blog'],
    ['GET', '/api/blog/image?url=https%3A%2F%2Fimages.pexels.com%2Fphoto.jpg'],
  ])('keeps intentional public surface %s %s', async (method, path) => {
    const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`, { method }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it.each([
    ['POST', '/api/blog'],
    ['PATCH', '/api/blog'],
    ['GET', '/api/blog/queue'],
    ['DELETE', '/api/blog/queue?id=00000000-0000-4000-8000-000000000000'],
    ['POST', '/api/blog/reindex'],
    ['POST', '/api/blog/mrt-hotel-ranking'],
    ['POST', '/api/blog/ad-mapping'],
    ['POST', '/api/blog/bulk-generate'],
    ['POST', '/api/blog/from-card-news'],
    ['POST', '/api/blog/report-error'],
  ])('returns 401 before anonymous %s %s', async (method, path) => {
    const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`, { method }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('allows a valid admin API token to reach the route-local guard', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token');

    const response = await middleware(new NextRequest('https://www.yeosonam.com/api/blog', {
      method: 'POST',
      headers: { 'x-admin-token': 'test-admin-token' },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('accepts only the valid cron bearer on the card-news bridge', async () => {
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');

    const accepted = await middleware(new NextRequest(
      'https://www.yeosonam.com/api/blog/from-card-news',
      { method: 'POST', headers: { authorization: 'Bearer test-cron-secret' } },
    ));
    const rejected = await middleware(new NextRequest(
      'https://www.yeosonam.com/api/blog/from-card-news',
      { method: 'POST', headers: { authorization: 'Bearer wrong' } },
    ));

    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('x-middleware-next')).toBe('1');
    expect(rejected.status).toBe(403);
  });
});

describe('middleware content-hub API boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ['GET', '/api/content-hub'],
    ['PATCH', '/api/content-hub'],
    ['DELETE', '/api/content-hub?id=00000000-0000-4000-8000-000000000000'],
    ['POST', '/api/content-hub/generate'],
    ['POST', '/api/content-hub/publish'],
  ])('returns 401 before anonymous %s %s', async (method, path) => {
    const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`, { method }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('allows a valid admin API token to reach the content-hub route-local guard', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'test-admin-token');

    const response = await middleware(new NextRequest('https://www.yeosonam.com/api/content-hub', {
      method: 'PATCH',
      headers: { 'x-admin-token': 'test-admin-token' },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});

describe('middleware tenant portal boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    '/tenant/00000000-0000-4000-8000-00000000000a/products',
    '/api/tenant/rfqs?tenant_id=00000000-0000-4000-8000-00000000000a',
  ])('does not let an anonymous request enter %s', async (path) => {
    const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
  });

  it('allows the explicit development admin preview cookie to reach route-local tenant authorization', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/api/tenant/products?tenant_id=00000000-0000-4000-8000-00000000000a',
      { headers: { cookie: 'ys-dev-admin=1' } },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  const tenantS2sPaths = [
    '/api/tenant/products?tenant_id=00000000-0000-4000-8000-00000000000a',
    '/api/tenant/inventory?tenant_id=00000000-0000-4000-8000-00000000000a',
    '/api/tenant/settlements?tenant_id=00000000-0000-4000-8000-00000000000a',
    '/api/tenant/rfqs?tenant_id=00000000-0000-4000-8000-00000000000a',
    '/api/tenants',
    '/api/tenants/00000000-0000-4000-8000-00000000000a',
  ];

  it.each(tenantS2sPaths)(
    'lets a valid S2S platform-admin token reach the route-local guard: %s',
    async (path) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ADMIN_API_TOKEN', 'tenant-s2s-token');

      const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`, {
        headers: { 'x-admin-token': 'tenant-s2s-token' },
      }));

      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    },
  );

  it.each(tenantS2sPaths)(
    'rejects an invalid S2S platform-admin token before the tenant route: %s',
    async (path) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ADMIN_API_TOKEN', 'tenant-s2s-token');

      const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`, {
        headers: { 'x-admin-token': 'wrong-token' },
      }));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
    },
  );

  it.each(tenantS2sPaths)(
    'keeps the normal login boundary when the S2S token is missing: %s',
    async (path) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('ADMIN_API_TOKEN', 'tenant-s2s-token');

      const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`));

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toContain('/login');
    },
  );
});
