import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  record: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock('./server-events', () => ({
  recordServerAnalyticsEvent: mocks.record,
}));

import { analyticsOutboxRetryAt, processAnalyticsEventOutbox } from './event-outbox';

describe('analytics event outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue({ id: 'server-event-1', idempotent: false });
  });

  it('uses bounded exponential retry delays', () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    expect(analyticsOutboxRetryAt(1, now)).toBe('2026-08-12T00:01:00.000Z');
    expect(analyticsOutboxRetryAt(4, now)).toBe('2026-08-12T00:08:00.000Z');
    expect(analyticsOutboxRetryAt(99, now)).toBe('2026-08-12T02:08:00.000Z');
  });

  it('claims and records a transactional lead event once', async () => {
    const row = {
      id: 'outbox-1',
      event_name: 'generate_lead',
      idempotency_key: 'lead:lead-1',
      source_type: 'lead',
      source_id: 'lead-1',
      lead_id: '10000000-0000-4000-8000-000000000001',
      booking_id: null,
      product_id: '20000000-0000-4000-8000-000000000002',
      transaction_id: null,
      assisting_content_creative_id: null,
      search_query_hash: 'a'.repeat(64),
      value_krw: null,
      attribution_snapshot: null,
      event_payload: { lead_type: 'package_inquiry' },
      occurred_at: '2026-08-12T00:00:00.000Z',
      attempt_count: 0,
    };
    let call = 0;
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe('analytics_server_event_outbox');
      call += 1;
      if (call === 1) {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              lt: vi.fn().mockResolvedValue({ error: null }),
            })),
          })),
        };
      }
      if (call === 2) {
        return {
          select: vi.fn(() => ({
            in: vi.fn(() => ({
              or: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({ data: [row], error: null }),
                })),
              })),
            })),
          })),
        };
      }
      if (call === 3) {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: row.id }, error: null }),
                })),
              })),
            })),
          })),
        };
      }
      if (call === 4) {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ error: null }),
            })),
          })),
        };
      }
      throw new Error(`unexpected outbox call ${call}`);
    });

    await expect(processAnalyticsEventOutbox(10)).resolves.toEqual({
      attempted: 1,
      processed: 1,
      failed: 0,
      dead: 0,
    });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'generate_lead',
      idempotencyKey: 'lead:lead-1',
      searchQueryHash: 'a'.repeat(64),
    }));
  });
});
