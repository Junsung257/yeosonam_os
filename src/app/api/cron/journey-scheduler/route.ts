import { NextRequest, NextResponse } from 'next/server';
import { requireCronBearer } from '@/lib/cron-auth';
import { isSupabaseConfigured, supabase, createMessageLog } from '@/lib/supabase';
import { getNotificationAdapter } from '@/lib/notification-adapter';

/**
 * 고객 여정 타임머신 스케줄러
 * Vercel Cron: 매일 UTC 00:00 (KST 09:00) 자동 실행
 * 강제 실행: GET /api/cron/journey-scheduler?force=true
 *
 * D-15: deposit_paid → waiting_balance 전이 + BALANCE_NOTICE 로그
 * D-3:  출발 확정서 안내 (CONFIRMATION_GUIDE) 로그
 * D+1:  귀국 해피콜 (HAPPY_CALL) 로그
 */
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const authErr = requireCronBearer(request);
  if (authErr) return authErr;

  const isForce = request.nextUrl.searchParams.get('force') === 'true';

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dateStr = (d: Date) => d.toISOString().slice(0, 10);

  const d15 = new Date(today); d15.setDate(d15.getDate() + 15);
  const d3  = new Date(today); d3.setDate(d3.getDate() + 3);
  const dp1 = new Date(today); dp1.setDate(dp1.getDate() - 1);

  const processed = { d15: 0, d3: 0, d_plus1: 0, errors: [] as string[] };
  const adapter = getNotificationAdapter();

  // ─── D-15: deposit_paid → waiting_balance + 잔금 안내 ───────────────
  try {
    const { data: d15Bookings } = await supabase
      .from('bookings')
      .select('id, booking_no, package_title, total_price, departure_date, customers!lead_customer_id(name, phone)')
      .eq('departure_date', dateStr(d15))
      .eq('status', 'deposit_paid')
      .eq('is_deleted', false);

    for (const b of d15Bookings ?? []) {
      try {
        await supabase
          .from('bookings')
          .update({ status: 'waiting_balance', updated_at: new Date().toISOString() })
          .eq('id', b.id);

        const customer = (b as { customers?: { name?: string; phone?: string } }).customers;
        await adapter.send({
          bookingId:     b.id,
          eventType:     'BALANCE_NOTICE',
          title:         '잔금 안내 발송 (D-15 자동)',
          content:       `출발 15일 전 잔금 납부 안내가 발송됩니다.`,
          customerName:  customer?.name,
          customerPhone: customer?.phone,
          metadata: {
            packageTitle: (b as { package_title?: string }).package_title,
            departureDate: (b as { departure_date?: string }).departure_date,
          },
        });
        processed.d15++;
      } catch (e) {
        processed.errors.push(`D-15 ${(b as { booking_no?: string }).booking_no}: ${e}`);
      }
    }
  } catch (e) {
    processed.errors.push(`D-15 쿼리 실패: ${e}`);
  }

  // ─── D-3: 출발 확정서 안내 ─────────────────────────────────────────
  try {
    const { data: d3Bookings } = await supabase
      .from('bookings')
      .select('id, booking_no, package_title, departure_date, customers!lead_customer_id(name, phone)')
      .eq('departure_date', dateStr(d3))
      .in('status', ['waiting_balance', 'fully_paid', 'completed'])
      .eq('is_deleted', false);

    for (const b of d3Bookings ?? []) {
      try {
        const customer = (b as { customers?: { name?: string; phone?: string } }).customers;
        await createMessageLog({
          booking_id: b.id,
          log_type:   'scheduler',
          event_type: 'CONFIRMATION_GUIDE',
          title:      '출발 확정서 안내 (D-3 자동)',
          content:    `출발 3일 전입니다. 최종 출발 확정서가 발송됩니다.`,
          is_mock:    !customer?.phone,
          created_by: 'cron',
        });
        processed.d3++;
      } catch (e) {
        processed.errors.push(`D-3 ${(b as { booking_no?: string }).booking_no}: ${e}`);
      }
    }
  } catch (e) {
    processed.errors.push(`D-3 쿼리 실패: ${e}`);
  }

  // ─── D+1: 귀국 해피콜 ─────────────────────────────────────────────
  try {
    const { data: dp1Bookings } = await supabase
      .from('bookings')
      .select('id, booking_no, package_title, departure_date, customers!lead_customer_id(name, phone)')
      .eq('departure_date', dateStr(dp1))
      .in('status', ['fully_paid', 'completed'])
      .eq('is_deleted', false);

    for (const b of dp1Bookings ?? []) {
      try {
        await createMessageLog({
          booking_id: b.id,
          log_type:   'scheduler',
          event_type: 'HAPPY_CALL',
          title:      '귀국 해피콜 (D+1 자동)',
          content:    '여행은 즐거우셨나요? 귀국 확인 해피콜이 예정됩니다.',
          is_mock:    false,
          created_by: 'cron',
        });
        processed.d_plus1++;
      } catch (e) {
        processed.errors.push(`D+1 ${(b as { booking_no?: string }).booking_no}: ${e}`);
      }
    }
  } catch (e) {
    processed.errors.push(`D+1 쿼리 실패: ${e}`);
  }

  console.log('[여정 스케줄러]', processed);
  return NextResponse.json({
    ok: true,
    is_force: isForce,
    processed,
    run_at: new Date().toISOString(),
  });
}
