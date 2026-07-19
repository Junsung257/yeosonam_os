import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishToMetaAds } from './meta-ads-publisher';

vi.mock('@/lib/secret-registry', () => ({
  getSecret: vi.fn((key: string) => ({
    META_AD_ACCOUNT_ID: 'act_123',
    META_ADS_ACCESS_TOKEN: 'token',
    META_PAGE_ID: 'page-1',
  })[key]),
}));

vi.mock('@/lib/app-config', () => ({
  isMetaAdsTestMode: vi.fn(() => false),
}));

function metaResponse(id: string) {
  return {
    ok: true,
    json: vi.fn(async () => ({ id })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('publishToMetaAds', () => {
  it('creates Meta campaign, ad set, and ad as paused drafts even outside test mode', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(metaResponse('campaign-1'))
      .mockResolvedValueOnce(metaResponse('adset-1'))
      .mockResolvedValueOnce(metaResponse('creative-1'))
      .mockResolvedValueOnce(metaResponse('ad-1'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToMetaAds({
      primary_texts: ['Draft primary'],
      headlines: ['Draft headline'],
      descriptions: ['Draft description'],
      cta_button: 'LEARN_MORE',
      landing_url: 'https://yeosonam.com/packages/product-1',
    });

    expect(result.status).toBe('draft');
    expect(result.test_mode).toBe(false);

    const statuses = fetchMock.mock.calls
      .map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as { status?: string })
      .map((body) => body.status)
      .filter(Boolean);

    expect(statuses).toEqual(['PAUSED', 'PAUSED', 'PAUSED']);
    expect(statuses).not.toContain('ACTIVE');
  });
});
