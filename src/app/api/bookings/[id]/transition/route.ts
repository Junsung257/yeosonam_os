import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { isValidTransition, ALLOWED_TRANSITIONS } from '@/lib/booking-state-machine';
import { getNotificationAdapter } from '@/lib/notification-adapter';

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
    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('id, booking_no, status, package_title, departure_date, total_price, deposit_amount, customers!lead_customer_id(name, phone)')
      .eq('id', params.id)
      .single();

    if (fetchErr || !booking) {
      return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
    }

    const from = (booking as { status: string }).status;

    if (!isValidTransition(from, to)) {
      return NextResponse.json(
        { error: `${from} → ${to} 전이는 허용되지 않습니다.` },
        { status: 422 }
      );
    }

    // 상태 업데이트
    const { data: updated, error: updateErr } = await supabase
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
    const notifResult = await adapter.send({
      bookingId:    params.id,
      eventType:    transitionDef?.eventType ?? 'DEPOSIT_NOTICE',
      title:        transitionDef?.logTitle ?? `상태 변경: ${from} → ${to}`,
      content:      transitionDef?.logContent,
      customerName: customer?.name,
      customerPhone: customer?.phone,
      metadata: {
        packageTitle: (booking as { package_title?: string }).package_title,
        departureDate: (booking as { departure_date?: string }).departure_date,
      },
    });

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
