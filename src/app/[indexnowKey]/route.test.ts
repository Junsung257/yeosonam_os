import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

describe('IndexNow key route', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves the configured IndexNow key at the root txt path', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'deadbeef');

    const response = await GET(new Request('https://www.yeosonam.com/deadbeef.txt'), {
      params: Promise.resolve({ indexnowKey: 'deadbeef.txt' }),
    });

    await expect(response.text()).resolves.toBe('deadbeef');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('does not expose arbitrary txt paths when the key does not match', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'deadbeef');

    const response = await GET(new Request('https://www.yeosonam.com/other.txt'), {
      params: Promise.resolve({ indexnowKey: 'other.txt' }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('does not match root non-txt paths', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'deadbeef');

    const response = await GET(new Request('https://www.yeosonam.com/deadbeef'), {
      params: Promise.resolve({ indexnowKey: 'deadbeef' }),
    });

    expect(response.status).toBe(404);
  });

  it('stays closed when INDEXNOW_KEY is not configured', async () => {
    vi.stubEnv('INDEXNOW_KEY', '');

    const response = await GET(new Request('https://www.yeosonam.com/anything.txt'), {
      params: Promise.resolve({ indexnowKey: 'anything.txt' }),
    });

    expect(response.status).toBe(404);
  });

  it('stays closed for a key that global IndexNow accepts but Naver rejects', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'test-indexnow-key_123');

    const response = await GET(new Request('https://www.yeosonam.com/test-indexnow-key_123.txt'), {
      params: Promise.resolve({ indexnowKey: 'test-indexnow-key_123.txt' }),
    });

    expect(response.status).toBe(404);
  });
});
