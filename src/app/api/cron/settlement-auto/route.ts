/**
 * 자동 정산 크론 — 매월 1일 실행 (전월 정산 자동 마감)
 * GET /api/cron/settlement-auto
 *
 * 모든 어필리에이트를 순회하며 전월 정산을 자동 실행합니다.
 * 출발일이 전월이고 귀국일이 지난 예약만 대상.
 * Vercel Cron 또는 수동 호출 가능.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { AFFILIATE_CONFIG } from '@/lib/affiliateConfig';

const { SETTLEMENT_MIN_AMOUNT: MIN_AMOUNT, SETTLEMENT_MIN_BOOKINGS: MIN_COUNT, PERSONAL_TAX_RATE } = AFFILIATE_CONFIG;

/**
 * 2026-04-15 변경: 자비스 기안 전용 모드 기본값.
 * ENABLE_DIRECT_SETTLEMENT=true 환경변수가 있을 때만 기존 방식으로 직접 READY 마감.
 * 기본은 /api/cron/affiliate-settlement-draft가 agent_actions 기안 → 사장님 결재함 승인.
 */
export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });

  if (process.env.ENABLE_DIRECT_SETTLEMENT !== 'true') {
    return NextResponse.json({
      skipped: true,
      message: '자비스 기안 모드 활성. /api/cron/affiliate-settlement-draft를 사용하세요.',
    });
  }

  try {
    // 전월 period 계산
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const period = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
    const periodStart = `${period}-01`;
    const periodEnd = new Date(prevYear, prevMonth, 0).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    console.log(`[정산 크론] ${period} 자동 정산 시작`);

    // 모든 활성 어필리에이트 조회
    const { data: affiliates } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, payout_type, booking_count')
      .eq('is_active', true);

    if (!affiliates || affiliates.length === 0) {
      return NextResponse.json({ message: '활성 어필리에이트 없음', period });
    }

    let processed = 0;
    let qualified = 0;
    let carried = 0;
    const results: { name: string; status: string; amount: number }[] = [];

    for (const aff of affiliates) {
      // 이미 정산 완료된 건 스킵
      const { data: existing } = await supabaseAdmin
        .from('settlements')
        .select('id, status')
        .eq('affiliate_id', aff.id)
        .eq('settlement_period', period)
        .maybeSingle();

      if (existing && ['READY', 'COMPLETED'].includes(existing.status)) {
        continue; // 이미 처리됨
      }

      // 해당 period 확정 예약 조회
      const { data: bookings } = await supabaseAdmin
        .from('bookings')
        .select('id, influencer_commission, return_date, status')
        .eq('affiliate_id', aff.id)
        .in('status', ['confirmed', 'completed', 'fully_paid'])
        .gte('departure_date', periodStart)
        .lte('departure_date', periodEnd)
        .lte('return_date', today)
        .or('is_deleted.is.null,is_deleted.eq.false');

      const qualifiedBookings = (bookings || []).filter((b: { return_date?: string }) => b.return_date && b.return_date <= today);
      const count = qualifiedBookings.length;
      const totalAmount = qualifiedBookings.reduce((s: number, b: unknown) => s + ((b as { influencer_commission?: number }).influencer_commission || 0), 0);

      // 이전 달 이월 조회
      const prevPrevMonth = prevMonth === 1 ? 12 : prevMonth - 1;
      const prevPrevYear = prevMonth === 1 ? prevYear - 1 : prevYear;
      const prevPeriod = `${prevPrevYear}-${String(prevPrevMonth).padStart(2, '0')}`;

      const { data: prevSettlement } = await supabaseAdmin
        .from('settlements')
        .select('carryover_balance')
        .eq('affiliate_id', aff.id)
        .eq('settlement_period', prevPeriod)
        .maybeSingle();

      const prevCarryover = (prevSettlement as any)?.carryover_balance ?? 0;

      const isQualified = count >= MIN_COUNT && totalAmount >= MIN_AMOUNT;

      if (!isQualified) {
        // 이월 처리
        await supabaseAdmin
          .from('settlements')
          .upsert({
            affiliate_id: aff.id,
            settlement_period: period,
            qualified_booking_count: count,
            total_amount: totalAmount,
            carryover_balance: prevCarryover + totalAmount,
            final_total: 0,
            tax_deduction: 0,
            final_payout: 0,
            status: 'PENDING',
          }, { onConflict: 'affiliate_id,settlement_period' });

        carried++;
        results.push({ name: aff.name, status: 'PENDING (이월)', amount: totalAmount });
      } else {
        // 정산 확정
        const finalTotal = totalAmount + prevCarryover;
        const taxDeduction = aff.payout_type === 'PERSONAL' ? Math.round(finalTotal * PERSONAL_TAX_RATE) : 0;
        const finalPayout = finalTotal - taxDeduction;

        await supabaseAdmin
          .from('settlements')
          .upsert({
            affiliate_id: aff.id,
            settlement_period: period,
            qualified_booking_count: count,
            total_amount: totalAmount,
            carryover_balance: prevCarryover,
            final_total: finalTotal,
            tax_deduction: taxDeduction,
            final_payout: finalPayout,
            status: 'READY',
          }, { onConflict: 'affiliate_id,settlement_period' });

        // booking_count 업데이트 (등급 트리거)
        await supabaseAdmin
          .from('affiliates')
          .update({ booking_count: (aff.booking_count || 0) + count })
          .eq('id', aff.id);

        qualified++;
        results.push({ name: aff.name, status: 'READY', amount: finalPayout });
      }
      processed++;
    }

    // audit_log
    await supabaseAdmin.from('audit_logs').insert([{
      action: 'SETTLEMENT_AUTO_CRON',
      target_type: 'settlement',
      description: `${period} 자동 정산: ${processed}명 처리 (확정 ${qualified}, 이월 ${carried})`,
      after_value: { period, processed, qualified, carried, results },
    }]).then(() => {}).catch(() => {});

    console.log(`[정산 크론] 완료: ${processed}명 (확정 ${qualified}, 이월 ${carried})`);

    return NextResponse.json({ period, processed, qualified, carried, results });
  } catch (err) {
    console.error('[정산 크론 실패]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '정산 크론 실패' }, { status: 500 });
  }
}
