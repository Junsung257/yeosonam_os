import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('IndexNow key route', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves the configured IndexNow key at the root txt path', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'test-indexnow-key_123');

    const response = await GET(new Request('https://www.yeosonam.com/test-indexnow-key_123.txt'), {
      params: Promise.resolve({ indexnowKey: 'test-indexnow-key_123' }),
    });

    await expect(response.text()).resolves.toBe('test-indexnow-key_123');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('does not expose arbitrary txt paths when the key does not match', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'test-indexnow-key_123');

    const response = await GET(new Request('https://www.yeosonam.com/other.txt'), {
      params: Promise.resolve({ indexnowKey: 'other' }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('stays closed when INDEXNOW_KEY is not configured', async () => {
    vi.stubEnv('INDEXNOW_KEY', '');

    const response = await GET(new Request('https://www.yeosonam.com/anything.txt'), {
      params: Promise.resolve({ indexnowKey: 'anything' }),
    });

    expect(response.status).toBe(404);
  });
});
