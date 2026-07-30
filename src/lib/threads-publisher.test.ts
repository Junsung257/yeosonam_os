import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishToThreads } from './threads-publisher';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Threads publisher credential transport', () => {
  it('publishes with bearer authorization and never puts the token in URL or form data', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'container-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'post-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'post-1',
            permalink: 'https://www.threads.com/@yeosonam/post/example',
          }),
          { status: 200 },
        ),
      );

    const result = await publishToThreads({
      threadsUserId: '123',
      accessToken: 'secret-token',
      text: '도쿄 가족여행 이동 시간을 줄이는 현실적인 방법을 정리했습니다',
    });

    expect(result).toMatchObject({ ok: true, postId: 'post-1', verified: true });
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain('secret-token');
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer secret-token',
      );
      expect(String(init?.body ?? '')).not.toContain('access_token');
    }
  });

  it('rejects an invalid continuation before publishing the root post', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await publishToThreads({
      threadsUserId: '123',
      accessToken: 'secret-token',
      text: '도쿄 가족여행 이동 시간을 줄이는 현실적인 방법을 정리했습니다',
      replyThreads: ['가'.repeat(501)],
    });

    expect(result).toMatchObject({ ok: false, step: 'validate' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
