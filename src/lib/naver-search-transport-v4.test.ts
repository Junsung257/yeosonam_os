import { describe, expect, it, vi } from 'vitest';
import { buildNaverSearchRequestsV4, fetchNaverSearchV4 } from './naver-search-transport-v4';

describe('Naver search transport V4', () => {
  it('uses API HUB first and keeps the legacy API as fallback', () => {
    const requests = buildNaverSearchRequestsV4({
      query: '다낭 10월 날씨', vertical: 'blog',
      env: {
        NAVER_API_HUB_CLIENT_ID: 'hub-id', NAVER_API_HUB_CLIENT_SECRET: 'hub-secret',
        NAVER_CLIENT_ID: 'legacy-id', NAVER_CLIENT_SECRET: 'legacy-secret',
      },
    });
    expect(requests.map((request) => request.transport)).toEqual(['api_hub', 'developers_legacy']);
    expect(requests[0]).toMatchObject({ headers: {
      'X-NCP-APIGW-API-KEY-ID': 'hub-id', 'X-NCP-APIGW-API-KEY': 'hub-secret',
    } });
    expect(requests[0].url).toContain('/search/v1/blog?');
  });

  it('falls back to legacy on HUB HTTP failure', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ title: 'ok' }] }) });
    const result = await fetchNaverSearchV4<{ items: unknown[] }>({
      query: '세부 호텔 추천', vertical: 'webkr', fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {
        NAVER_API_HUB_CLIENT_ID: 'hub-id', NAVER_API_HUB_CLIENT_SECRET: 'hub-secret',
        NAVER_CLIENT_ID: 'legacy-id', NAVER_CLIENT_SECRET: 'legacy-secret',
      },
    });
    expect(result.transport).toBe('developers_legacy');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails explicitly without a complete credential pair', async () => {
    await expect(fetchNaverSearchV4({ query: 'x', vertical: 'blog', env: {} }))
      .rejects.toThrow('credentials_missing');
  });
});
