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
});
