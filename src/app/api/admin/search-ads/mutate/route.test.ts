import { describe, expect, it, vi, afterEach } from 'vitest';
import { POST } from './route';
import type { SearchAdKeyword } from '@/lib/keyword-brain';

function keyword(overrides: Partial<SearchAdKeyword> = {}): SearchAdKeyword {
  return {
    id: 'nkw-real-keyword-id',
    keyword: 'danang package',
    matchType: 'exact',
    tier: 'core',
    suggestedBid: 900,
    category: 'travel',
    platform: 'naver',
    bid: 900,
    status: 'active',
    impressions: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    conversions: 0,
    spend: 0,
    roas: 0,
    createdAt: '2026-06-18T00:00:00.000Z',
    ...overrides,
  };
}

function adminPost(body: unknown) {
  const req = new Request('http://localhost/api/admin/search-ads/mutate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as Request & { cookies: { get: (name: string) => { value: string } | undefined } };
  req.cookies = {
    get: (name: string) => (name === 'ys-dev-admin' ? { value: '1' } : undefined),
  };
  return req as never;
}

describe('POST /api/admin/search-ads/mutate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('blocks Naver mutations when the live account is not configured', async () => {
    vi.stubEnv('NAVER_ADS_API_KEY', '');
    vi.stubEnv('NAVER_ADS_SECRET_KEY', '');
    vi.stubEnv('NAVER_ADS_CUSTOMER_ID', '');

    const response = await POST(adminPost({
      action: 'update_bid',
      keyword: keyword(),
      bid: 1200,
    }));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toMatchObject({
      ok: false,
      blocked: true,
      reason: 'naver_ads_unconfigured',
    });
    expect(json.missing).toEqual(expect.arrayContaining([
      'NAVER_ADS_API_KEY',
      'NAVER_ADS_SECRET_KEY',
      'NAVER_ADS_CUSTOMER_ID',
    ]));
  });

  it('rejects local Google keyword ids before any live mutation', async () => {
    const response = await POST(adminPost({
      action: 'pause',
      keyword: keyword({ id: 'local-google-keyword', platform: 'google' }),
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      ok: false,
      blocked: true,
      reason: 'invalid_external_keyword_id',
    });
  });
});
