import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type MessageKind = 'received' | 'deposit' | 'unavailable';

function isMessageKind(value: string | null): value is MessageKind {
  return value === 'received' || value === 'deposit' || value === 'unavailable';
}

function buildMessage(kind: MessageKind, booking: Record<string, unknown>, account: string): string {
  const customer = booking.customers as { name?: string | null; phone?: string | null } | null;
  const adultCount = Number(booking.adult_count ?? 0);
  const childCount = Number(booking.child_count ?? 0);
  const totalPrice = Number(booking.total_price ?? 0);
  const depositAmountRaw = Number(booking.deposit_amount ?? 0);
  const depositAmount = depositAmountRaw > 0 ? depositAmountRaw : Math.max(0, Math.round(totalPrice * 0.1));
  const common = [
    `예약번호: ${booking.booking_no || String(booking.id).slice(0, 8)}`,
    `상품명: ${booking.package_title || '-'}`,
    `출발일: ${booking.departure_date || '-'}`,
    `인원: 성인 ${adultCount}명 / 아동 ${childCount}명`,
    `예약자: ${customer?.name || '-'} ${customer?.phone || ''}`.trim(),
  ];

  if (kind === 'deposit') {
    return [
      '안녕하세요, 여소남입니다.',
      '랜드사 좌석 가능 여부 확인되어 계약금 안내드립니다.',
      '',
      ...common,
      `예상 총액: ${totalPrice.toLocaleString('ko-KR')}원`,
      `계약금: ${depositAmount.toLocaleString('ko-KR')}원`,
      `입금계좌: ${account}`,
      '',
      '입금 후 카카오톡으로 입금자명을 남겨주시면 확인 후 예약 확정 안내드리겠습니다.',
    ].join('\n');
  }

  if (kind === 'unavailable') {
    return [
      '안녕하세요, 여소남입니다.',
      '문의주신 일정은 현재 좌석 가능 여부를 확인한 결과 진행이 어렵습니다.',
      '',
      ...common,
      '',
      '가능한 다른 출발일 또는 유사 상품으로 다시 확인해드리겠습니다.',
    ].join('\n');
  }

  return [
    '안녕하세요, 여소남입니다.',
    '예약 요청이 접수되어 랜드사 좌석 가능 여부를 확인 중입니다.',
    '',
    ...common,
    '',
    '확인되는 즉시 카카오톡으로 안내드리겠습니다.',
  ].join('\n');
}

const getHandler = async (
  request: NextRequest,
  ctx?: { params: Promise<{ id: string }> | { id: string } },
) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const params = await ctx?.params;
  const id = params?.id;
  const kindParam = request.nextUrl.searchParams.get('kind');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (!isMessageKind(kindParam)) {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  }

  const { data: booking, error } = await supabaseAdmin
    .from('bookings')
    .select('id, booking_no, package_title, departure_date, adult_count, child_count, total_price, deposit_amount, customers!lead_customer_id(name, phone)')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!booking) return NextResponse.json({ error: 'booking not found' }, { status: 404 });

  const account = getSecret('COMPANY_ACCOUNT') || '[계좌번호 입력]';
  return NextResponse.json({
    message: buildMessage(kindParam, booking as Record<string, unknown>, account),
  });
};

export const GET = withAdminGuard(getHandler);
