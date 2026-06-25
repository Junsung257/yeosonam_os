import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCronAuthorized, withCronGuard } from './cron-auth';

describe('withCronGuard resource saver', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('skips guarded non-critical crons while DB resource saver is enabled', async () => {
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
      ok: true,
      skipped: true,
      cron: 'fill-attraction-photos',
      reason: 'db_resource_saver_mode',
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
});
