import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const select = vi.fn(() => ({ maybeSingle }));
  const lt = vi.fn(() => ({ select }));
  const eqStatus = vi.fn(() => ({ lt }));
  const eqId = vi.fn(() => ({ eq: eqStatus }));
  const update = vi.fn(() => ({ eq: eqId }));
  const from = vi.fn(() => ({ update }));
  const getSupabaseAdmin = vi.fn(() => ({ from }));
  return { maybeSingle, select, lt, eqStatus, eqId, update, from, getSupabaseAdmin };
});

vi.mock('../supabase', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

import { claimExpiredRfqBidTimeout } from './rfq-server';

describe('RFQ timeout conditional claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseAdmin.mockReturnValue({ from: mocks.from });
  });

  it('claims only a still-locked and expired bid', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'bid-1' }, error: null });

    await expect(claimExpiredRfqBidTimeout('bid-1')).resolves.toBe(true);

    expect(mocks.from).toHaveBeenCalledWith('rfq_bids');
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'timeout', is_penalized: true,
    }));
    expect(mocks.eqId).toHaveBeenCalledWith('id', 'bid-1');
    expect(mocks.eqStatus).toHaveBeenCalledWith('status', 'locked');
    expect(mocks.lt).toHaveBeenCalledWith('submit_deadline', expect.any(String));
    expect(mocks.select).toHaveBeenCalledWith('id');
  });

  it('returns false when another worker already changed the status', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(claimExpiredRfqBidTimeout('bid-1')).resolves.toBe(false);
  });
});
