import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  createVoucher,
  getVoucher,
  getVoucherByBooking,
  updateVoucher,
} from '@/lib/supabase';
import { generateVoucherData, renderVoucherHtml, type RawVoucherInput } from '@/lib/voucher-generator';
import { sendVoucherIssuedAlimtalk } from '@/lib/kakao';

// ── Mock ───────────────────────────────────────────────────────

function mockVoucher(raw: RawVoucherInput) {
  const parsed = generateVoucherData(raw);
  return {
    id: `voucher-mock-${Date.now()}`,
    booking_id: raw.booking_id ?? null,
    rfq_id: raw.rfq_id ?? null,
    parsed_data: parsed,
    upsell_data: parsed.upsell,
    pdf_url: null,
    status: 'issued',
    issued_at: new Date().toISOString(),
    review_notified: false,
    mock: true,
  };
}

// ── POST /api/voucher — 확정서 생성 ───────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    raw: RawVoucherInput;
    customer_id?: string;
    land_agency_id?: string;
    customer_phone?: string; // 알림톡 발송용
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.raw) {
    return NextResponse.json({ error: 'raw 원시 데이터가 필요합니다' }, { status: 400 });
  }

  const raw = body.raw;

  if (!raw.customer_name || !raw.destination || !raw.departure_date || !raw.end_date) {
    return NextResponse.json(
      { error: 'customer_name, destination, departure_date, end_date 는 필수입니다' },
      { status: 400 }
    );
  }
  if (raw.total_selling_price === undefined || raw.total_cost === undefined) {
    return NextResponse.json(
      { error: 'total_selling_price(판매가)와 total_cost(원가)는 필수입니다' },
      { status: 400 }
    );
  }

  // ── 여소남 표준 확정서 데이터 생성 + 업셀링 자동 주입 ──────
  const voucherData = generateVoucherData(raw);

  if (!isSupabaseConfigured) {
    const mock = mockVoucher(raw);
    return NextResponse.json({ voucher: mock }, { status: 201 });
  }

  const voucher = await createVoucher({
    booking_id: raw.booking_id ?? null,
    rfq_id: raw.rfq_id ?? null,
    customer_id: body.customer_id ?? null,
    land_agency_id: body.land_agency_id ?? null,
    parsed_data: voucherData,
    upsell_data: voucherData.upsell,
    pdf_url: null,
    status: 'issued',
    issued_at: new Date().toISOString(),
    sent_at: null,
    end_date: raw.end_date,
    review_notified: false,
  });

  if (!voucher) {
    return NextResponse.json({ error: '확정서 저장 실패' }, { status: 500 });
  }

  // ── 알림톡 발송 (비동기 fire-and-forget) ──────────────────
  const phone = body.customer_phone ?? raw.customer_phone;
  if (phone) {
    void sendVoucherIssuedAlimtalk({
      phone,
      name: raw.customer_name,
      productTitle: voucherData.travel.product_title,
      departureDate: raw.departure_date,
      voucherId: voucher.id,
    });
  }

  return NextResponse.json({ voucher }, { status: 201 });
}

// ── GET /api/voucher?id=...&bookingId=... ──────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const id        = searchParams.get('id');
  const bookingId = searchParams.get('bookingId');
  const withHtml  = searchParams.get('html') === 'true';

  if (!id && !bookingId) {
    return NextResponse.json({ error: 'id 또는 bookingId가 필요합니다' }, { status: 400 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정 (개발 환경)' }, { status: 503 });
  }

  const voucher = id
    ? await getVoucher(id)
    : await getVoucherByBooking(bookingId!);

  if (!voucher) {
    return NextResponse.json({ error: '확정서를 찾을 수 없습니다' }, { status: 404 });
  }

  // ?html=true 요청 시 렌더링된 HTML 포함
  if (withHtml) {
    const html = renderVoucherHtml(voucher.parsed_data);
    return NextResponse.json({ voucher, html });
  }

  return NextResponse.json({ voucher });
}

// ── PATCH /api/voucher — 상태 변경 (issued → sent) ────────────

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let body: {
    id: string;
    status?: 'draft' | 'issued' | 'sent' | 'cancelled';
    pdf_url?: string;
    customer_phone?: string; // sent 상태로 변경 시 알림톡 재발송
    customer_name?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: 'id가 필요합니다' }, { status: 400 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: true, mock: true });
  }

  const patch: Partial<{
    status: 'draft' | 'issued' | 'sent' | 'cancelled';
    pdf_url: string;
    sent_at: string;
  }> = {};

  if (body.status) patch.status = body.status;
  if (body.pdf_url) patch.pdf_url = body.pdf_url;
  if (body.status === 'sent') patch.sent_at = new Date().toISOString();

  const updated = await updateVoucher(body.id, patch);
  if (!updated) {
    return NextResponse.json({ error: '업데이트 실패' }, { status: 500 });
  }

  // sent 상태 전환 시 알림톡 재발송
  if (body.status === 'sent' && body.customer_phone && body.customer_name) {
    void sendVoucherIssuedAlimtalk({
      phone: body.customer_phone,
      name: body.customer_name,
      productTitle: updated.parsed_data.travel.product_title,
      departureDate: updated.parsed_data.travel.departure_date,
      voucherId: updated.id,
    });
  }

  return NextResponse.json({ voucher: updated });
}
