import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishDistribution, type ScheduledDistributionRow } from './distribution-publisher';
import { publishToThreads } from '@/lib/threads-publisher';
import { evaluateThreadsDistribution } from '@/lib/content-pipeline/threads-automation';
import { publishToMetaAds } from '@/lib/content-pipeline/publishers/meta-ads-publisher';

const updateMock = vi.fn();
const eqMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      update: updateMock,
      insert: vi.fn(),
      select: vi.fn(),
      eq: eqMock,
    })),
  },
}));

vi.mock('@/lib/threads-publisher', () => ({
  getThreadsConfig: vi.fn(async () => ({ threadsUserId: 'threads-user', accessToken: 'token' })),
  publishToThreads: vi.fn(async () => ({
    ok: true,
    postId: 'post-1',
    permalink: 'https://www.threads.com/@yeosonam/post/test',
    verified: true,
  })),
}));

vi.mock('@/lib/content-pipeline/threads-automation', async () => {
  const actual = await vi.importActual<typeof import('@/lib/content-pipeline/threads-automation')>('@/lib/content-pipeline/threads-automation');
  return {
    ...actual,
    evaluateThreadsDistribution: vi.fn(),
  };
});

vi.mock('@/lib/content-pipeline/publishers/meta-ads-publisher', () => ({
  publishToMetaAds: vi.fn(async () => ({ status: 'published', campaign_id: 'campaign-1', external_url: 'https://meta.test/campaign-1' })),
}));

function row(overrides: Partial<ScheduledDistributionRow> = {}): ScheduledDistributionRow {
  return {
    id: 'dist-1',
    product_id: 'product-1',
    card_news_id: null,
    blog_post_id: null,
    platform: 'threads_post',
    payload: { main: 'This Jeju family trip saves time without feeling rushed' },
    scheduled_for: '2026-06-03T00:00:00.000Z',
    engagement: {},
    tenant_id: null,
    retry_count: 0,
    max_retries: 3,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateMock.mockReturnValue({ eq: eqMock });
  eqMock.mockResolvedValue({ error: null });
});

describe('publishDistribution', () => {
  it('publishes Threads with a precomputed critic gate and persists success', async () => {
    const result = await publishDistribution(row(), {
      precomputedGate: {
        approved: true,
        predicted_er: 0.08,
        text: 'This Jeju family trip saves time without feeling rushed',
        fullText: 'This Jeju family trip saves time without feeling rushed',
      },
    });

    expect(result.status).toBe('published');
    expect(result.external_id).toBe('post-1');
    expect(result.external_url).toBe('https://www.threads.com/@yeosonam/post/test');
    expect(vi.mocked(evaluateThreadsDistribution)).not.toHaveBeenCalled();
    expect(vi.mocked(publishToThreads)).toHaveBeenCalledWith(expect.objectContaining({
      threadsUserId: 'threads-user',
      text: 'This Jeju family trip saves time without feeling rushed',
    }));
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'published',
      external_id: 'post-1',
      external_url: 'https://www.threads.com/@yeosonam/post/test',
      retry_count: 0,
      error_message: null,
      engagement: expect.objectContaining({ predicted_er: 0.08, verification_status: 'verified' }),
    }));
  });

  it('filters malformed stored media and continuation values before provider calls', async () => {
    await publishDistribution(
      row({
        payload: {
          main: 'This Jeju family trip saves time without feeling rushed',
          image_urls: ['https://example.com/one.jpg', 7, null, ''],
          thread: ['A valid continuation sentence.', { text: 'bad' }, '', null],
        },
      }),
      {
        precomputedGate: {
          approved: true,
          predicted_er: 0.08,
          text: 'This Jeju family trip saves time without feeling rushed',
          fullText: 'This Jeju family trip saves time without feeling rushed',
        },
      },
    );

    expect(vi.mocked(publishToThreads)).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrls: ['https://example.com/one.jpg'],
        replyThreads: ['A valid continuation sentence.'],
      }),
    );
  });

  it('retries failed Threads publish before max retries', async () => {
    vi.mocked(publishToThreads).mockResolvedValueOnce({ ok: false, error: 'provider error' });

    const result = await publishDistribution(row({ retry_count: 1 }), {
      precomputedGate: {
        approved: true,
        predicted_er: 0.04,
        text: 'This Jeju family trip saves time without feeling rushed',
        fullText: 'This Jeju family trip saves time without feeling rushed',
      },
    });

    expect(result.status).toBe('failed');
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'scheduled',
      retry_count: 2,
      error_message: 'provider error',
      scheduled_for: expect.any(String),
    }));
  });

  it('marks failed after max retries', async () => {
    vi.mocked(publishToThreads).mockResolvedValueOnce({ ok: false, error: 'provider error' });

    await publishDistribution(row({ retry_count: 2, max_retries: 3 }), {
      precomputedGate: {
        approved: true,
        predicted_er: 0.04,
        text: 'This Jeju family trip saves time without feeling rushed',
        fullText: 'This Jeju family trip saves time without feeling rushed',
      },
    });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      retry_count: 3,
      error_message: 'provider error',
    }));
  });

  it('keeps Meta Ads publish results as draft when provider creates paused assets', async () => {
    vi.mocked(publishToMetaAds).mockResolvedValueOnce({
      status: 'draft',
      campaign_id: 'campaign-1',
      external_url: 'https://meta.test/campaign-1',
      test_mode: false,
    });

    const result = await publishDistribution(row({
      platform: 'meta_ads',
      payload: {
        primary_texts: ['Safe draft copy'],
        headlines: ['Draft headline'],
        descriptions: ['Draft description'],
        cta_button: 'LEARN_MORE',
      },
    }));

    expect(result).toEqual({
      status: 'draft',
      external_id: 'campaign-1',
      external_url: 'https://meta.test/campaign-1',
      reason: 'Meta Ads assets were created as PAUSED drafts pending manual approval',
    });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'draft',
      published_at: null,
      external_id: 'campaign-1',
      external_url: 'https://meta.test/campaign-1',
      retry_count: 0,
      error_message: 'Meta Ads assets were created as PAUSED drafts pending manual approval',
    }));
  });
});
