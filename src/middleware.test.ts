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
});
