import { describe, expect, it, vi } from 'vitest';
import { findUnansweredReplies, ThreadsEngagementClient } from './client';

describe('Threads engagement client', () => {
  it('finds nested unanswered replies and excludes replies already answered by us', () => {
    const result = findUnansweredReplies(
      {
        id: '100',
        text: '도쿄 여행 이야기',
        username: 'yeosonam',
        timestamp: '2026-07-28T00:00:00Z',
      },
      [
        {
          id: '201',
          text: '첫 댓글',
          username: 'guest1',
          timestamp: '2026-07-28T00:01:00Z',
          repliedToId: '100',
        },
        {
          id: '202',
          text: '운영자 답변',
          username: 'yeosonam',
          timestamp: '2026-07-28T00:02:00Z',
          repliedToId: '201',
          isOwnedByMe: true,
        },
        {
          id: '203',
          text: '중첩 추가 질문',
          username: 'guest1',
          timestamp: '2026-07-28T00:03:00Z',
          repliedToId: '202',
        },
      ],
      'yeosonam',
    );

    expect(result.map((item) => item.id)).toEqual(['203']);
    expect(result[0]).toMatchObject({
      kind: 'reply',
      rootPostId: '100',
      rootPostText: '도쿄 여행 이야기',
    });
  });

  it('publishes a reply with the official two-step flow and no token in the URL', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '301' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '302' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ permalink: 'https://www.threads.com/@yeosonam/post/example' }),
          { status: 200 },
        ),
      );
    const wait = vi.fn(async () => undefined);
    const client = new ThreadsEngagementClient(
      { accessToken: 'secret-token', userId: '123' },
      fetchMock,
      wait,
    );

    const result = await client.publishReply('답변입니다', '200');

    expect(result.id).toBe('302');
    expect(wait).toHaveBeenCalledWith(1_500);
    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(String(createUrl)).toBe('https://graph.threads.net/v1.0/me/threads');
    expect(String(createUrl)).not.toContain('secret-token');
    expect((createInit?.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-token',
    );
    expect(String(createInit?.body)).toContain('reply_to_id=200');
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://graph.threads.net/v1.0/me/threads_publish',
    );
  });

  it('paginates mentions with the provider cursor', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: '401', text: '첫 멘션', username: 'guest1' }],
            paging: { cursors: { after: 'next-page' } },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: '402', text: '두 번째 멘션', username: 'guest2' }],
          }),
          { status: 200 },
        ),
      );
    const client = new ThreadsEngagementClient(
      { accessToken: 'secret-token', userId: '123' },
      fetchMock,
    );

    const mentions = await client.fetchMentions(2);

    expect(mentions.map((item) => item.id)).toEqual(['401', '402']);
    expect(String(fetchMock.mock.calls[1][0])).toContain('after=next-page');
  });

  it('fails closed when it cannot verify whether a mention was already answered', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'temporary provider failure', code: 2 } }),
        { status: 500 },
      ),
    );
    const client = new ThreadsEngagementClient(
      { accessToken: 'secret-token', userId: '123' },
      fetchMock,
    );

    await expect(client.isDirectlyAnsweredByMe('401', 'yeosonam')).rejects.toThrow(
      'Threads API',
    );
  });
});
