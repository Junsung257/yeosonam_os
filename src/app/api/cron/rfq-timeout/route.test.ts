import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cron-auth', () => ({
  withCronGuard: (handler: (request: NextRequest) => Promise<Response>) => handler,
}));

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true }));

vi.mock('@/lib/db/rfq-server', () => ({
  getExpiredBids: vi.fn(),
  claimExpiredRfqBidTimeout: vi.fn(),
  updateTenantReliability: vi.fn(),
  createRfqMessage: vi.fn(),
}));

import {
  createRfqMessage,
  getExpiredBids,
  claimExpiredRfqBidTimeout,
  updateTenantReliability,
} from '@/lib/db/rfq-server';
import { GET } from './route';

describe('RFQ timeout cron service repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes expired bids only through the service-role RFQ repository', async () => {
    vi.mocked(getExpiredBids).mockResolvedValue([{
      id: 'bid-1', rfq_id: 'rfq-1', tenant_id: 'tenant-a', status: 'locked',
      locked_at: '2026-07-19T00:00:00.000Z', submit_deadline: '2026-07-19T03:00:00.000Z',
      is_penalized: false,
    }]);
    vi.mocked(claimExpiredRfqBidTimeout).mockResolvedValue(true);
    vi.mocked(updateTenantReliability).mockResolvedValue(undefined);
    vi.mocked(createRfqMessage).mockResolvedValue({ id: 'message-1' } as never);

    const response = await GET(new NextRequest('https://www.yeosonam.com/api/cron/rfq-timeout'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ processed: 1, timeout_bids: ['bid-1'] });
    expect(claimExpiredRfqBidTimeout).toHaveBeenCalledWith('bid-1');
    expect(updateTenantReliability).toHaveBeenCalledWith('tenant-a', -5);
    expect(createRfqMessage).toHaveBeenCalledWith(expect.objectContaining({ rfq_id: 'rfq-1', sender_type: 'system' }));
  });

  it('skips reliability and messages when another cron already claimed the bid', async () => {
    vi.mocked(getExpiredBids).mockResolvedValue([{
      id: 'bid-1', rfq_id: 'rfq-1', tenant_id: 'tenant-a', status: 'locked',
      locked_at: '2026-07-19T00:00:00.000Z', submit_deadline: '2026-07-19T03:00:00.000Z',
      is_penalized: false,
    }]);
    vi.mocked(claimExpiredRfqBidTimeout).mockResolvedValue(false);

    const response = await GET(new NextRequest('https://www.yeosonam.com/api/cron/rfq-timeout'));

    await expect(response.json()).resolves.toMatchObject({ processed: 0, timeout_bids: [] });
    expect(updateTenantReliability).not.toHaveBeenCalled();
    expect(createRfqMessage).not.toHaveBeenCalled();
  });
});
