import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabase: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  insertRow: vi.fn(),
  updateRow: vi.fn(),
}));

vi.mock('../supabase', () => ({
  getSupabase: mocks.getSupabase,
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

vi.mock('./helpers', () => ({
  insertRow: mocks.insertRow,
  updateRow: mocks.updateRow,
  updateRowsWhere: vi.fn(),
}));

import {
  createVoucher,
  getVoucher,
  getVoucherByBooking,
  updateVoucher,
} from './voucher';

function voucherClient() {
  const terminal = vi.fn().mockResolvedValue({ data: null });
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: terminal,
  };
  return { from: vi.fn(() => chain), chain };
}

describe('voucher DB client boundary', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the service-role client for create, read, booking lookup, and update', async () => {
    const client = voucherClient();
    mocks.getSupabaseAdmin.mockReturnValue(client);
    mocks.insertRow.mockResolvedValue(null);
    mocks.updateRow.mockResolvedValue(null);

    await createVoucher({
      booking_id: 'booking-a',
      parsed_data: {} as never,
      upsell_data: [],
      status: 'draft',
      review_notified: false,
    });
    await getVoucher('voucher-a');
    await getVoucherByBooking('booking-a');
    await updateVoucher('voucher-a', { status: 'issued' });

    expect(mocks.getSupabaseAdmin).toHaveBeenCalledTimes(4);
    expect(mocks.getSupabase).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledWith('vouchers');
  });
});
