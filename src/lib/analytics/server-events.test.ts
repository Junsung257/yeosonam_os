import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSecret: vi.fn(),
  deliveryUpsert: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock('@/lib/secret-registry', () => ({
  getSecret: mocks.getSecret,
}));

import {
  isSyntheticAnalyticsServerEvent,
  normalizeServerAttribution,
  recordServerAnalyticsEvent,
} from './server-events';

describe('analytics server event boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSecret.mockReturnValue(null);
    mocks.deliveryUpsert.mockResolvedValue({ error: null });
  });

  it('rejects PII payload keys before any database write', async () => {
    await expect(recordServerAnalyticsEvent({
      eventName: 'generate_lead',
      idempotencyKey: 'lead:1',
      sourceType: 'lead',
      sourceId: '1',
      payload: { phone: '010-1234-5678' },
    })).rejects.toThrow('PII key is not allowed');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects PII hidden inside an attribution field', () => {
    expect(normalizeServerAttribution({
      version: 1,
      attributionSessionId: '00000000-0000-4000-8000-000000000001',
      lastTouch: { term: '010-1234-5678' },
      expiresAt: '2026-08-01T00:00:00.000Z',
    })).toBeNull();
  });

  it('recovers an existing event and upserts delivery jobs idempotently', async () => {
    const lookupSingle = vi.fn().mockResolvedValue({
      data: { id: 'event-1' },
      error: null,
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === 'analytics_server_events') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '23505', message: 'duplicate' },
              }),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single: lookupSingle })),
          })),
        };
      }
      if (table === 'analytics_delivery_jobs') {
        return { upsert: mocks.deliveryUpsert };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const result = await recordServerAnalyticsEvent({
      eventName: 'ysn_booking_confirmed',
      idempotencyKey: 'booking-confirmed:1',
      sourceType: 'booking',
      sourceId: '1',
      transactionId: 'booking:1',
      valueKrw: 500_000,
      payload: {
        transaction_id: 'booking:1',
        currency: 'KRW',
        value: 500_000,
      },
    });

    expect(result).toEqual({ id: 'event-1', idempotent: true });
    expect(mocks.deliveryUpsert).toHaveBeenCalledOnce();
    expect(mocks.deliveryUpsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          destination: 'google_ads_data_manager',
          idempotency_key: 'booking-confirmed:1',
        }),
      ]),
      {
        onConflict: 'destination,idempotency_key',
        ignoreDuplicates: true,
      },
    );
  });

  it('persists the blog assist and query hash on a server-side lead event', async () => {
    const eventInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'event-2' }, error: null }),
      })),
    }));
    mocks.from.mockImplementation((table: string) => {
      if (table === 'analytics_server_events') return { insert: eventInsert };
      if (table === 'analytics_delivery_jobs') return { upsert: mocks.deliveryUpsert };
      throw new Error(`unexpected table: ${table}`);
    });

    const queryHash = 'a'.repeat(64);
    const result = await recordServerAnalyticsEvent({
      eventName: 'generate_lead',
      idempotencyKey: 'lead:lead-2',
      sourceType: 'lead',
      sourceId: 'lead-2',
      leadId: '30000000-0000-4000-8000-000000000003',
      productId: '40000000-0000-4000-8000-000000000004',
      assistingContentCreativeId: '50000000-0000-4000-8000-000000000005',
      searchQueryHash: queryHash,
      attribution: {
        version: 1,
        attributionSessionId: '60000000-0000-4000-8000-000000000006',
        lastTouch: { term: '오사카 숙소 위치', landingPath: '/blog/osaka-hotel-area' },
        expiresAt: '2026-09-01T00:00:00.000Z',
      },
      payload: { lead_type: 'package_inquiry', assisted_by_blog: true },
    });

    expect(result).toEqual({ id: 'event-2', idempotent: false });
    expect(eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      assisting_content_creative_id: '50000000-0000-4000-8000-000000000005',
      search_query_hash: queryHash,
      event_name: 'generate_lead',
      attribution_snapshot: expect.objectContaining({
        lastTouch: { landingPath: '/blog/osaka-hotel-area' },
      }),
    }));
    expect(JSON.stringify(eventInsert.mock.calls)).not.toContain('오사카 숙소 위치');
    expect(mocks.deliveryUpsert).toHaveBeenCalledOnce();
  });

  it('stores an internal synthetic marker without delivering it to GA4 or ads', async () => {
    const eventInsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'probe-event' }, error: null }),
      })),
    }));
    mocks.from.mockImplementation((table: string) => {
      if (table === 'analytics_server_events') return { insert: eventInsert };
      throw new Error(`unexpected table: ${table}`);
    });

    await expect(recordServerAnalyticsEvent({
      eventName: 'generate_lead',
      idempotencyKey: 'probe:analytics:2026-08-16',
      sourceType: 'lead',
      sourceId: 'probe-2026-08-16',
      payload: { pipeline: 'blog_assist' },
      synthetic: true,
    })).resolves.toEqual({ id: 'probe-event', idempotent: false });

    expect(eventInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_payload: { pipeline: 'blog_assist', __synthetic: true },
    }));
    expect(mocks.deliveryUpsert).not.toHaveBeenCalled();
    expect(isSyntheticAnalyticsServerEvent({ __synthetic: true })).toBe(true);
  });

  it('rejects callers attempting to forge the reserved synthetic marker', async () => {
    await expect(recordServerAnalyticsEvent({
      eventName: 'generate_lead',
      idempotencyKey: 'lead:forged',
      sourceType: 'lead',
      sourceId: 'forged',
      payload: { __synthetic: true },
    })).rejects.toThrow('reserved for internal probes');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
