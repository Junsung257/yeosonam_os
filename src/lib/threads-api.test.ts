import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchThreadsInsights, probeThreadsIdentity, verifyThreadsPostOwnership } from './threads-api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('threads-api', () => {
  it('classifies Threads insights identity mismatches', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        message: 'Unsupported get request. Object with ID does not exist.',
        type: 'THApiException',
        code: 100,
        error_subcode: 33,
      },
    }), { status: 400 }));

    const result = await fetchThreadsInsights('post-1', 'token');

    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('identity_or_permission_mismatch');
  });

  it('parses identity probes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      id: '123456789',
      username: 'yeosonam',
    }), { status: 200 }));

    const result = await probeThreadsIdentity('token');

    expect(result).toMatchObject({ ok: true, id: '123456789', username: 'yeosonam' });
  });

  it('verifies a published post and returns its permalink', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'post-1',
      permalink: 'https://www.threads.com/@yeosonam/post/test',
      timestamp: '2026-06-03T00:00:00+0000',
    }), { status: 200 }));

    const result = await verifyThreadsPostOwnership('post-1', 'token');

    expect(result).toMatchObject({
      verified: true,
      postId: 'post-1',
      permalink: 'https://www.threads.com/@yeosonam/post/test',
    });
  });
});
