import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_PUBLIC_APP_ORIGIN,
  buildPublicUrl,
  resolvePublicAppOrigin,
} from './public-app-origin';

describe('public app origin', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the canonical origin when the environment value is absent', () => {
    expect(resolvePublicAppOrigin('')).toBe(CANONICAL_PUBLIC_APP_ORIGIN);
  });

  it('rejects non-canonical production hosts', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => resolvePublicAppOrigin('https://yeosonam.co.kr'))
      .toThrow('PUBLIC_APP_ORIGIN must be https://www.yeosonam.com');
  });

  it('builds encoded public paths without changing the canonical host', () => {
    expect(buildPublicUrl('/packages/pkg-1?ref=PARTNER'))
      .toBe('https://www.yeosonam.com/packages/pkg-1?ref=PARTNER');
  });
});
