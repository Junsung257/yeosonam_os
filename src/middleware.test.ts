import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { middleware } from './middleware';

describe('middleware external API V1 boundary', () => {
  it.each([
    ['/api/v1/openapi', 'GET'],
    ['/api/v1/openapi', 'HEAD'],
    ['/api/v1/packages', 'GET'],
    ['/api/v1/packages', 'POST'],
    ['/api/v1/qa/chat', 'POST'],
    ['/api/v1/voice/chat', 'POST'],
  ])('lets %s %s reach its route-local contract/auth guard', async (path, method) => {
    const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`, { method }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it.each([
    ['/api/v1/openapi', 'POST'],
    ['/api/v1/packages', 'DELETE'],
    ['/api/v1/qa/chat', 'GET'],
    ['/api/v1/voice/chat', 'GET'],
  ])('does not make unsupported method public: %s %s', async (path, method) => {
    const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`, { method }));

    expect(response.headers.get('x-middleware-next')).not.toBe('1');
  });
});

describe('middleware research intake boundary', () => {
  it('lets the exact research intake route reach its dedicated bearer guard', async () => {
    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/api/internal/research/signals',
      { method: 'POST' },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});

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

  it.each([
    'rank-tracking',
    'blog-data-readiness',
    'blog-publisher',
    'blog-generate',
    'blog-publication-controller',
    'blog-indexing-worker',
    'analytics-delivery',
  ])('allows the verified blog operating chain when critical crons are explicitly enabled: %s', async (cron) => {
    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '1');
    vi.stubEnv('DB_RESOURCE_SAVER_ALLOW_CRITICAL_CRONS', '1');

    const response = await middleware(new NextRequest(
      `https://www.yeosonam.com/api/cron/${cron}`,
      { headers: { 'x-vercel-cron': '1' } },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it.each([
    'blog-ai-model-canary',
    'blog-analytics-canary',
  ])('lets release canaries reach their route-local bearer guard: %s', async (cron) => {
    const response = await middleware(new NextRequest(
      `https://www.yeosonam.com/api/cron/${cron}`,
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('lets the Clobe bank sync reach its route-local cron bearer guard', async () => {
    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/api/cron/clobe-bank-sync',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it.each([
    '/api/cron/product-registration-v6-backfill',
    '/api/cron/product-registration-v6-watchdog',
  ])('lets product registration cron %s reach its route-local bearer guard', async (path) => {
    const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not resource-save a trusted Clobe bank sync invocation', async () => {
    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '1');

    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/api/cron/clobe-bank-sync',
      { headers: { 'x-vercel-cron': '1' } },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('returns a hard noindex tombstone for archived blog slugs', async () => {
    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/blog/july-family-travel-weather-clothes-checklist-2026',
    ));

    expect(response.status).toBe(410);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it.each([
    'travel-emergency-medicine-summer-checklist',
    'post-hv01',
  ])('returns 410 for unsafe medication content and its legacy alias: %s', async (slug) => {
    const response = await middleware(new NextRequest(
      `https://www.yeosonam.com/blog/${slug}`,
    ));

    expect(response.status).toBe(410);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});

describe('middleware blog public status contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns a hard 404 only when the least-privilege public registry proves the slug is absent', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await middleware(new NextRequest('https://www.yeosonam.com/blog/review-blocked-fixture'));

    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/rest/v1/public_blog_slug_registry' }),
      expect.not.objectContaining({ headers: expect.objectContaining({ apikey: 'service-key' }) }),
    );
  });

  it('passes through present slugs and fails open to durable snapshots when the registry is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(new Response('[{"id":"creative-a"}]', { status: 200 }));

    const found = await middleware(new NextRequest('https://www.yeosonam.com/blog/public-fixture'));
    expect(found.status).toBe(200);
    expect(found.headers.get('x-middleware-next')).toBe('1');

    fetchSpy.mockRejectedValueOnce(new Error('registry unavailable'));
    const unavailable = await middleware(new NextRequest('https://www.yeosonam.com/blog/outage-fixture'));
    expect(unavailable.status).toBe(200);
    expect(unavailable.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not treat the image sitemap route as a dynamic article slug', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/blog/image-sitemap.xml',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('middleware package availability preflight credentials', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses one service-only RPC for customer route state', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
    // The CI release gate provides a dummy service-role key globally. Override
    // it so this test remains deterministic and still verifies server-key
    // precedence over the public publishable key.
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-secret-key');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'server-secret-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      state: 'PUBLIC',
      package_id: 'fbca42ad-50cd-4622-bde0-5dc13009e833',
      catalog_product_id: '64af7a2d-6f01-43ae-8a0b-dc801fcd89d7',
      revision_id: '6ab6bb12-ffd4-4f4b-a1f8-1d665b993ef4',
      snapshot_id: '43e69df4-e6aa-4b0a-ba22-eca91dd11501',
      pointer_version: 4,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/packages/fbca42ad-50cd-4622-bde0-5dc13009e833',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    const [requestUrl, requestInit] = fetchSpy.mock.calls[0] ?? [];
    expect(requestUrl).toBeInstanceOf(URL);
    expect((requestUrl as URL).pathname).toBe('/rest/v1/rpc/get_product_registration_customer_route_state');
    expect(requestInit).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        apikey: 'server-secret-key',
        authorization: 'Bearer server-secret-key',
      }),
    }));
    expect(JSON.parse(String((requestInit as RequestInit).body))).toMatchObject({
      p_tenant_id: '00000000-0000-0000-0000-000000000001',
      p_route_ref: 'fbca42ad-50cd-4622-bde0-5dc13009e833',
      p_channel: 'customer',
      p_locale: 'ko-KR',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('never falls back to a public key for the customer route-state RPC', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/packages/fbca42ad-50cd-4622-bde0-5dc13009e833',
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'PACKAGE_AVAILABILITY_UNAVAILABLE' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 410 for a published pointer with a sale-blocking overlay', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-secret-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ state: 'SALE_UNAVAILABLE' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/lp/2624427e-8e9c-45d3-90e5-a0af602a22d3',
    ));
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ code: 'PACKAGE_SALE_UNAVAILABLE' });
  });

  it('returns a hard 404 when the route-state boundary has no published pointer', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-secret-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ state: 'NOT_FOUND' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/packages/00000000-0000-4000-8000-000000000001',
    ));

    expect(response.status).toBe(404);
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

describe('middleware backend P0 server-token pass-through', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    '/api/billing/issue-billing-key',
    '/api/voucher',
    '/api/upload',
  ])('allows a valid server admin token to reach the route-local guard for %s', async (path) => {
    vi.stubEnv('ADMIN_API_TOKEN', 'backend-p0-admin-token');

    const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`, {
      method: 'POST',
      headers: { 'x-admin-token': 'backend-p0-admin-token' },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('rejects an invalid server admin token before the upload handler', async () => {
    vi.stubEnv('ADMIN_API_TOKEN', 'backend-p0-admin-token');

    const response = await middleware(new NextRequest('https://www.yeosonam.com/api/upload', {
      method: 'POST',
      headers: { 'x-admin-token': 'wrong-token' },
    }));

    expect(response.status).toBe(403);
  });
});

describe('middleware guide-token public entry points', () => {
  it('lets signed product registration proof pages reach their route-local verifier', async () => {
    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/product-registration-proof/packages/snapshot-a',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('lets voucher GET reach the route-local guide-token/admin guard', async () => {
    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/api/voucher?id=voucher-a&bookingId=booking-a&guideToken=token-a',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not make voucher mutations public', async () => {
    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/api/voucher',
      { method: 'POST' },
    ));

    expect(response.status).not.toBe(200);
    expect(response.headers.get('x-middleware-next')).not.toBe('1');
  });

  it('lets the signed mobile guide page reach its token verifier', async () => {
    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/m/guide/token-a',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
