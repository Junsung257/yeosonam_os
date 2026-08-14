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

  it.each([
    'rank-tracking',
    'blog-data-readiness',
    'blog-publisher',
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

  it('lets the Clobe bank sync reach its route-local cron bearer guard', async () => {
    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/api/cron/clobe-bank-sync',
    ));

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
});

describe('middleware blog public status contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns a hard 404 when the canonical public-eligibility RPC rejects a slug', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(false), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/blog/review-blocked-fixture',
    ));

    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('allows a slug accepted by the canonical public-eligibility RPC', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(true), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/blog/known-public-fixture',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('fails over to the page snapshot instead of returning a false 404 when the public view is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));

    const response = await middleware(new NextRequest(
      'https://www.yeosonam.com/blog/known-bundled-public-post',
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('uses the public Supabase key and narrow RPC for the eligibility preflight', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(false), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await middleware(new NextRequest('https://www.yeosonam.com/blog/unknown-fixture'));

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/rest/v1/rpc/is_blog_public_slug_eligible_v3' }),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ p_slug: 'unknown-fixture' }),
        headers: expect.objectContaining({ apikey: 'anon-key', authorization: 'Bearer anon-key' }),
      }),
    );
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
  ])('allows a valid server admin token to reach the route-local guard for %s', async (path) => {
    vi.stubEnv('ADMIN_API_TOKEN', 'backend-p0-admin-token');

    const response = await middleware(new NextRequest(`https://www.yeosonam.com${path}`, {
      method: 'POST',
      headers: { 'x-admin-token': 'backend-p0-admin-token' },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});

describe('middleware guide-token public entry points', () => {
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
