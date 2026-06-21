import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isDbResourceSaverEnabled,
  isDbResourceSaverProductCronAllowlistEnabled,
  maybeSkipCronForResourceSaver,
  maybeSkipNonCriticalCron,
  shouldSkipPublicDbReadsForResourceSaver,
} from './cron-resource-saver';

function cronRequest(url = 'https://www.yeosonam.com/api/cron/example') {
  return new NextRequest(url);
}

describe('cron resource saver', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('can be explicitly enabled or disabled by env', () => {
    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '1');
    expect(isDbResourceSaverEnabled()).toBe(true);

    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '0');
    expect(isDbResourceSaverEnabled()).toBe(false);
  });

  it('skips non-critical crons while resource saver is enabled', async () => {
    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '1');

    const response = maybeSkipNonCriticalCron(cronRequest(), 'blog-daily-summary');

    expect(response).toBeInstanceOf(Response);
    await expect(response?.json()).resolves.toMatchObject({
      ok: true,
      skipped: true,
      cron: 'blog-daily-summary',
      reason: 'db_resource_saver_mode',
    });
  });

  it('allows forced crons and keeps product-readiness crons closed unless explicitly enabled', () => {
    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '1');

    expect(maybeSkipNonCriticalCron(cronRequest('https://www.yeosonam.com/api/cron/example?force=true'), 'blog-daily-summary')).toBeNull();
    expect(maybeSkipCronForResourceSaver(cronRequest(), 'entity-resolution')).toBeInstanceOf(Response);

    vi.stubEnv('DB_RESOURCE_SAVER_ALLOW_PRODUCT_CRONS', '1');
    expect(isDbResourceSaverProductCronAllowlistEnabled()).toBe(true);
    expect(maybeSkipCronForResourceSaver(cronRequest(), 'entity-resolution')).toBeNull();
  });

  it('keeps public db reads available unless explicitly blocked', () => {
    vi.stubEnv('DB_RESOURCE_SAVER_MODE', '1');

    expect(shouldSkipPublicDbReadsForResourceSaver()).toBe(false);

    vi.stubEnv('DB_RESOURCE_SAVER_PUBLIC_READS', '0');
    expect(shouldSkipPublicDbReadsForResourceSaver()).toBe(true);

    vi.stubEnv('DB_RESOURCE_SAVER_PUBLIC_READS', '1');
    expect(shouldSkipPublicDbReadsForResourceSaver()).toBe(false);

    vi.stubEnv('DB_RESOURCE_SAVER_PUBLIC_READS', '');
    vi.stubEnv('DB_RESOURCE_SAVER_BLOCK_PUBLIC_READS', '1');
    expect(shouldSkipPublicDbReadsForResourceSaver()).toBe(true);
  });
});
