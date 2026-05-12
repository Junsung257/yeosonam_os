import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { isValidTransition, ALLOWED_TRANSITIONS } from '@/lib/booking-state-machine';
import { getNotificationAdapter } from '@/lib/notification-adapter';
import { dispatchPushAsync } from '@/lib/push-dispatcher';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const { to } = await request.json();
    if (!to) {
      return NextResponse.json({ error: 'to (목표 상태) 가 필요합니다.' }, { status: 400 });
    }

    // 현재 예약 조회
    const { data: booking, error: fetchErr } = await supabaseAdmin
      .from('bookings')
      .select(
        'id, booking_no, status, package_title, departure_date, total_price, deposit_amount, paid_amount, deposit_notice_blocked, customers!lead_customer_id(name, phone)',
      )
      .eq('id', params.id)
      .single();

    if (fetchErr || !booking) {
      return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
    }

    const from = (booking as { status: string }).status;

    const blocked = (booking as { deposit_notice_blocked?: boolean }).deposit_notice_blocked === true;
    if (from === 'pending' && to === 'waiting_deposit' && blocked) {
      return NextResponse.json(
        {
          error:
            '운영자 승인 전에는 계약금 안내 단계로 넘길 수 없습니다. 예약 상세에서 "계약금 안내 허용"을 먼저 처리해 주세요.',
          code: 'DEPOSIT_NOTICE_BLOCKED',
        },
        { status: 409 },
      );
    }

    if (!isValidTransition(from, to)) {
      return NextResponse.json(
        { error: `${from} → ${to} 전이는 허용되지 않습니다.` },
        { status: 422 }
      );
    }

    // 상태 업데이트
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('bookings')
      .update({ status: to, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 전이 정의에서 로그 정보 가져오기
    const transitions = ALLOWED_TRANSITIONS[from] ?? [];
    const transitionDef = transitions.find(t => t.to === to);

    // 알림 어댑터로 message_log 생성 (+ 실제 알림톡 발송 시도)
    const customer = (booking as { customers?: { name?: string; phone?: string } }).customers;
    const adapter = getNotificationAdapter();
    const bRow = booking as {
      package_title?: string;
      departure_date?: string;
      total_price?: number;
      deposit_amount?: number;
      booking_no?: string;
    };
    const totalPrice = bRow.total_price ?? 0;
    const depositAmt =
      (bRow.deposit_amount ?? 0) > 0 ? (bRow.deposit_amount ?? 0) : Math.max(0, Math.round(totalPrice * 0.1));
    const depositDue = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
    const balanceDue =
      bRow.departure_date
        ? new Date(new Date(bRow.departure_date).getTime() - 14 * 86400000).toISOString().split('T')[0]
        : '출발 2주 전';

    const notifResult = await adapter.send({
      bookingId:    params.id,
      eventType:    transitionDef?.eventType ?? 'DEPOSIT_NOTICE',
      title:        transitionDef?.logTitle ?? `상태 변경: ${from} → ${to}`,
      content:      transitionDef?.logContent,
      customerName: customer?.name,
      customerPhone: customer?.phone,
      metadata: {
        packageTitle: bRow.package_title,
        departureDate: bRow.departure_date,
        bookingNo: bRow.booking_no,
        depositAmount: depositAmt,
        depositDueDate: depositDue,
        balance:
          to === 'waiting_balance' || transitionDef?.eventType === 'BALANCE_NOTICE'
            ? Math.max(0, totalPrice - ((booking as { paid_amount?: number }).paid_amount ?? 0))
            : undefined,
        dueDate: transitionDef?.eventType === 'BALANCE_NOTICE' ? balanceDue : depositDue,
      },
    });

    // 완납 전이 시 모바일 관리자 Web Push
    if (to === 'fully_paid') {
      dispatchPushAsync({
        title: '💰 완납 완료',
        body: `${(booking as { booking_no?: string }).booking_no ?? ''} · ${customer?.name ?? ''}`.trim(),
        deepLink: `/m/admin/bookings/${params.id}`,
        kind: 'fully_paid',
        tag: `booking-${params.id}`,
      });
    }

    return NextResponse.json({
      booking: updated,
      log: { id: notifResult.logId, isMock: notifResult.isMock },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '상태 전이 실패' },
      { status: 500 }
    );
  }
}
