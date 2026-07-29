import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isCronAuthorized,
  isCronBearerAuthenticated,
  isCronOrVercelAuthorized,
  requireCronBearer,
  withCronGuard,
} from './cron-auth';

describe('withCronGuard resource saver', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('blocks disabled mutation crons before the resource saver or handler', async () => {
    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '1');
    vi.stubEnv('CRON_SECRET', 'secret');

    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const guarded = withCronGuard(handler);
    const request = new NextRequest('https://www.yeosonam.com/api/cron/fill-attraction-photos', {
      headers: { authorization: 'Bearer secret' },
    });

    const response = await guarded(request);
    const body = await response.json();

    expect(handler).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      ok: false,
      error: { code: 'CRON_CAPABILITY_DISABLED' },
    });
  });

  it('runs guarded lightweight product crons only when the allowlist is explicitly enabled', async () => {
    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '1');
    vi.stubEnv('DB_RESOURCE_SAVER_ALLOW_PRODUCT_CRONS', '1');
    vi.stubEnv('CRON_SECRET', 'secret');

    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const guarded = withCronGuard(handler);
    const request = new NextRequest('https://www.yeosonam.com/api/cron/entity-resolution', {
      headers: { authorization: 'Bearer secret' },
    });

    const response = await guarded(request);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('rejects cron calls in production when CRON_SECRET is missing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');

    const request = new NextRequest('https://www.yeosonam.com/api/cron/blog-publisher');

    expect(isCronAuthorized(request)).toBe(false);
  });

  it('accepts only the configured bearer secret', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'secret');

    const valid = new NextRequest('https://www.yeosonam.com/api/cron/booking-tasks-runner', {
      headers: { authorization: 'Bearer secret' },
    });
    const invalid = new NextRequest('https://www.yeosonam.com/api/cron/booking-tasks-runner', {
      headers: { authorization: 'Bearer wrong' },
    });
    const missing = new NextRequest('https://www.yeosonam.com/api/cron/booking-tasks-runner');

    expect(isCronAuthorized(valid)).toBe(true);
    expect(isCronAuthorized(invalid)).toBe(false);
    expect(isCronAuthorized(missing)).toBe(false);
  });

  it('rejects the configured secret when it is supplied in the query string', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'secret');

    const request = new NextRequest(
      'https://www.yeosonam.com/api/cron/blog-publisher?secret=secret',
    );

    expect(isCronBearerAuthenticated(request)).toBe(false);
  });

  it('fails closed with a non-cacheable response when the production secret is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');

    const request = new NextRequest('https://www.yeosonam.com/api/cron/blog-publisher');
    const response = requireCronBearer(request);

    expect(response?.status).toBe(503);
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(await response?.json()).toMatchObject({
      ok: false,
      error: { code: 'CRON_UNAVAILABLE', message: 'Cron endpoint unavailable' },
    });
  });

  it('rejects a spoofed Vercel cron header without the configured bearer secret', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'secret');

    const request = new NextRequest('https://www.yeosonam.com/api/cron/booking-tasks-runner', {
      headers: { 'x-vercel-cron': '1' },
    });

    expect(isCronOrVercelAuthorized(request)).toBe(false);
  });

  it('accepts Vercel cron calls only when the configured bearer secret matches', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'secret');

    const request = new NextRequest('https://www.yeosonam.com/api/cron/booking-tasks-runner', {
      headers: {
        authorization: 'Bearer secret',
        'x-vercel-cron': '1',
      },
    });

    expect(isCronOrVercelAuthorized(request)).toBe(true);
  });

  it('rejects an otherwise valid bearer for a disabled mutation cron', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'secret');

    const request = new NextRequest('https://www.yeosonam.com/api/cron/blog-publisher', {
      headers: { authorization: 'Bearer secret' },
    });

    expect(isCronBearerAuthenticated(request)).toBe(true);
    expect(isCronAuthorized(request)).toBe(false);
  });
});
