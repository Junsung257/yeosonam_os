import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  verifyGuidebookToken: vi.fn(),
  createVoucher: vi.fn(),
  getVoucher: vi.fn(),
  getVoucherByBooking: vi.fn(),
  updateVoucher: vi.fn(),
  sendVoucherIssuedAlimtalk: vi.fn(),
}));

vi.mock('@/lib/admin-guard', () => ({ requireAdminRequest: mocks.requireAdminRequest }));
vi.mock('@/lib/guidebook-token', () => ({ verifyGuidebookToken: mocks.verifyGuidebookToken }));
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  createVoucher: mocks.createVoucher,
  getVoucher: mocks.getVoucher,
  getVoucherByBooking: mocks.getVoucherByBooking,
  updateVoucher: mocks.updateVoucher,
}));
vi.mock('@/lib/voucher-generator', () => ({
  generateVoucherData: vi.fn(() => ({
    travel: { product_title: 'Test trip', departure_date: '2026-08-01' },
    upsell: [],
  })),
  renderVoucherHtml: vi.fn(() => '<p>voucher</p>'),
}));
vi.mock('@/lib/kakao', () => ({ sendVoucherIssuedAlimtalk: mocks.sendVoucherIssuedAlimtalk }));

import { GET, PATCH, POST } from './route';

const voucherA = {
  id: 'voucher-a',
  booking_id: 'booking-a',
  parsed_data: { travel: { product_title: 'Trip A', departure_date: '2026-08-01' } },
};

function validVoucherBody() {
  return {
    raw: {
      booking_id: 'booking-a',
      customer_name: 'Customer',
      destination: 'Seoul',
      departure_date: '2026-08-01',
      end_date: '2026-08-02',
      total_selling_price: 100000,
      total_cost: 80000,
    },
  };
}

describe('/api/voucher security boundaries', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.getVoucher.mockReset();
  });

  it('rejects voucher creation before parsing an unauthenticated request body', async () => {
    mocks.requireAdminRequest.mockResolvedValueOnce(
      NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    );

    const response = await POST(new NextRequest('http://localhost/api/voucher', {
      method: 'POST',
      body: '{not-json',
    }));

    expect(response.status).toBe(401);
    expect(mocks.createVoucher).not.toHaveBeenCalled();
  });

  it('preserves voucher creation for a legitimate admin/server request', async () => {
    mocks.requireAdminRequest.mockResolvedValueOnce(null);
    mocks.createVoucher.mockResolvedValueOnce(voucherA);

    const response = await POST(new NextRequest('http://localhost/api/voucher', {
      method: 'POST',
      body: JSON.stringify(validVoucherBody()),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(201);
    expect(mocks.createVoucher).toHaveBeenCalledOnce();
  });

  it('rejects voucher mutation before parsing an unauthenticated request body', async () => {
    mocks.requireAdminRequest.mockResolvedValueOnce(
      NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    );

    const response = await PATCH(new NextRequest('http://localhost/api/voucher', {
      method: 'PATCH',
      body: '{not-json',
    }));

    expect(response.status).toBe(401);
    expect(mocks.updateVoucher).not.toHaveBeenCalled();
  });

  it('blocks a guide token from mixing booking A scope with voucher B id', async () => {
    mocks.verifyGuidebookToken.mockReturnValueOnce({
      bookingId: 'booking-a', voucherId: 'voucher-a', sessionId: 'session-a', scope: 'guide:read', exp: 9999999999,
    });
    mocks.requireAdminRequest.mockResolvedValueOnce(
      NextResponse.json({ code: 'AUTH_TOKEN_MISSING' }, { status: 401 }),
    );
    mocks.getVoucher.mockResolvedValueOnce({ ...voucherA, id: 'voucher-b', booking_id: 'booking-b' });

    const response = await GET(new NextRequest(
      'http://localhost/api/voucher?id=voucher-b&bookingId=booking-a&guideToken=token-a',
    ));

    expect(response.status).toBe(401);
    expect(mocks.getVoucher).not.toHaveBeenCalled();
  });

  it('preserves an id lookup when both guide token scopes match the voucher', async () => {
    mocks.verifyGuidebookToken.mockReturnValueOnce({
      bookingId: 'booking-a', voucherId: 'voucher-a', sessionId: 'session-a', scope: 'guide:read', exp: 9999999999,
    });
    mocks.getVoucher.mockResolvedValueOnce(voucherA);

    const response = await GET(new NextRequest(
      'http://localhost/api/voucher?id=voucher-a&bookingId=booking-a&guideToken=token-a',
    ));

    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).not.toHaveBeenCalled();
    expect(mocks.getVoucher).toHaveBeenCalledWith('voucher-a');
  });

  it('does not let a generic authenticated caller read an arbitrary voucher', async () => {
    mocks.verifyGuidebookToken.mockReturnValueOnce(null);
    mocks.requireAdminRequest.mockResolvedValueOnce(
      NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }),
    );

    const response = await GET(new NextRequest(
      'http://localhost/api/voucher?id=voucher-a',
    ));

    expect(response.status).toBe(403);
    expect(mocks.getVoucher).not.toHaveBeenCalled();
  });
});
