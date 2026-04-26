import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuthenticatedRoute } from '@/lib/session-guard';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

import { AFFILIATE_CONFIG } from '@/lib/affiliateConfig';

const { SETTLEMENT_MIN_AMOUNT: MIN_AMOUNT, SETTLEMENT_MIN_BOOKINGS: MIN_COUNT, PERSONAL_TAX_RATE } = AFFILIATE_CONFIG;

// GET: 정산 목록 조회
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const affiliateId = searchParams.get('affiliateId');
  const period = searchParams.get('period'); // "2026-03"

  const supabase = getSupabase();

  try {
    let query = supabase
      .from('settlements')
      .select('*, affiliates(id, name, referral_code, grade, payout_type)')
      .order('settlement_period', { ascending: false });

    if (affiliateId) query = query.eq('affiliate_id', affiliateId);
    if (period) query = query.eq('settlement_period', period);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ settlements: data || [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '조회 실패' }, { status: 500 });
  }
}

// POST: 월간 정산 마감 실행
export async function POST(request: NextRequest) {
  const guard = await requireAuthenticatedRoute(request);
  if (guard instanceof NextResponse) return guard;

  const supabase = getSupabase();

  try {
    const body = await request.json();
    const { affiliateId, period } = body; // period: "2026-03"

    if (!affiliateId) return NextResponse.json({ error: 'affiliateId가 필요합니다.' }, { status: 400 });
    if (!period) return NextResponse.json({ error: 'period가 필요합니다. (예: 2026-03)' }, { status: 400 });

    // ① 어필리에이트 정보 조회
    const { data: affiliate, error: aErr } = await supabase
      .from('affiliates')
      .select('id, name, payout_type, booking_count')
      .eq('id', affiliateId)
      .single();
    if (aErr || !affiliate) return NextResponse.json({ error: '어필리에이트를 찾을 수 없습니다.' }, { status: 404 });

    // ② 해당 period의 귀국일이 지난 확정 예약 조회
    const [year, month] = period.split('-').map(Number);
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEnd = new Date(year, month, 0).toISOString().split('T')[0]; // 월말
    const today = new Date().toISOString().split('T')[0];

    const { data: bookings, error: bErr } = await supabase
      .from('bookings')
      .select('id, influencer_commission, return_date, status, dispute_flag')
      .eq('affiliate_id', affiliateId)
      .in('status', ['confirmed', 'completed'])
      .gte('departure_date', periodStart)
      .lte('departure_date', periodEnd)
      .lte('return_date', today)   // 귀국일이 지난 것만
      .or('is_deleted.is.null,is_deleted.eq.false');

    if (bErr) throw bErr;

    const qualifiedBookings = (bookings || []).filter(b =>
      b.return_date && b.return_date <= today && !b.dispute_flag
    );
    const qualifiedCount = qualifiedBookings.length;
    const totalAmount = qualifiedBookings.reduce((s, b) => s + (b.influencer_commission || 0), 0);

    // ③ 이전 달 이월 잔액 조회
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    const { data: prevSettlement } = await supabase
      .from('settlements')
      .select('carryover_balance, status')
      .eq('affiliate_id', affiliateId)
      .eq('settlement_period', prevPeriod)
      .single();

    const prevCarryover = prevSettlement?.carryover_balance ?? 0;

    // ④ 조건 판단: 건수 + 금액 AND 조건 (cron과 동일 기준)
    const pendingTotal = totalAmount + prevCarryover;
    const qualified = qualifiedCount >= MIN_COUNT && pendingTotal >= MIN_AMOUNT;

    let settlement;
    if (!qualified) {
      // 조건 미달: 이월 처리
      const { data, error } = await supabase
        .from('settlements')
        .upsert({
          affiliate_id: affiliateId,
          settlement_period: period,
          qualified_booking_count: qualifiedCount,
          total_amount: totalAmount,
          carryover_balance: prevCarryover + totalAmount, // 누적 이월
          final_total: 0,
          tax_deduction: 0,
          final_payout: 0,
          status: 'PENDING',
        }, { onConflict: 'affiliate_id,settlement_period' })
        .select()
        .single();
      if (error) throw error;
      settlement = data;
    } else {
      // 조건 충족: 정산 확정
      const finalTotal = totalAmount + prevCarryover;
      const taxDeduction = affiliate.payout_type === 'PERSONAL'
        ? Math.round(finalTotal * PERSONAL_TAX_RATE)
        : 0;
      const finalPayout = finalTotal - taxDeduction;

      const { data, error } = await supabase
        .from('settlements')
        .upsert({
          affiliate_id: affiliateId,
          settlement_period: period,
          qualified_booking_count: qualifiedCount,
          total_amount: totalAmount,
          carryover_balance: prevCarryover,
          final_total: finalTotal,
          tax_deduction: taxDeduction,
          final_payout: finalPayout,
          status: 'READY',
        }, { onConflict: 'affiliate_id,settlement_period' })
        .select()
        .single();
      if (error) throw error;
      settlement = data;

      // 어필리에이트 booking_count 증가 (등급 트리거 발동)
      await supabase
        .from('affiliates')
        .update({ booking_count: affiliate.booking_count + qualifiedCount })
        .eq('id', affiliateId);

      // 이전 달 이월 리셋 (carryover_balance = 0으로 업데이트)
      if (prevSettlement && prevCarryover > 0) {
        await supabase
          .from('settlements')
          .update({ carryover_balance: 0 })
          .eq('affiliate_id', affiliateId)
          .eq('settlement_period', prevPeriod);
      }
    }

    // ⑤ audit_log 기록
    await supabase.from('audit_logs').insert([{
      action: 'SETTLEMENT_CLOSE',
      target_type: 'settlement',
      target_id: settlement?.id,
      description: `${affiliate.name} 님 ${period} 정산 마감 — 상태: ${settlement?.status}, 지급액: ${settlement?.final_payout?.toLocaleString()}원`,
      after_value: settlement,
    }]);

    return NextResponse.json({ settlement, qualified, qualifiedCount, totalAmount });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '정산 처리 실패' }, { status: 500 });
  }
}

// PATCH: 정산 상태 수동 변경 (COMPLETED, VOID + 원복)
export async function PATCH(request: NextRequest) {
  const guard = await requireAuthenticatedRoute(request);
  if (guard instanceof NextResponse) return guard;

  const supabase = getSupabase();

  try {
    const body = await request.json();
    const { id, status } = body;
    if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 });
    if (!['COMPLETED', 'VOID', 'PENDING', 'READY', 'HOLD'].includes(status)) {
      return NextResponse.json({ error: '유효하지 않은 상태값입니다.' }, { status: 400 });
    }

    // 현재 정산 정보 조회 (원복용)
    const { data: current, error: fetchErr } = await supabase
      .from('settlements')
      .select('*, affiliates(id, name, booking_count)')
      .eq('id', id)
      .single();

    if (fetchErr || !current) return NextResponse.json({ error: '정산을 찾을 수 없습니다.' }, { status: 404 });

    const payload: Record<string, unknown> = { status };
    if (status === 'COMPLETED') payload.settled_at = new Date().toISOString();

    // HOLD 처리
    if (status === 'HOLD') {
      payload.hold_reason = body.hold_reason || null;
      payload.held_at = new Date().toISOString();
    }
    // HOLD → READY 해제
    if (status === 'READY' && current.status === 'HOLD') {
      payload.released_at = new Date().toISOString();
      payload.hold_reason = null;
    }

    // ── VOID 원복 로직 ─────────────────────────────────
    if (status === 'VOID' && ['READY', 'COMPLETED'].includes(current.status)) {
      const affiliate = current.affiliates as any;

      // 1. booking_count 차감 (정산 시 증가한 만큼 되돌림)
      if (affiliate && current.qualified_booking_count > 0) {
        const newCount = Math.max(0, (affiliate.booking_count || 0) - current.qualified_booking_count);
        await supabase
          .from('affiliates')
          .update({ booking_count: newCount })
          .eq('id', current.affiliate_id);
      }

      // 2. 이월 잔액 복구 (이전 달 carryover를 다시 살림)
      if (current.carryover_balance > 0) {
        const [year, month] = current.settlement_period.split('-').map(Number);
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const prevPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

        await supabase
          .from('settlements')
          .update({ carryover_balance: current.carryover_balance })
          .eq('affiliate_id', current.affiliate_id)
          .eq('settlement_period', prevPeriod);
      }

      // 3. 현재 정산을 이월 상태로 되돌림
      payload.final_total = 0;
      payload.tax_deduction = 0;
      payload.final_payout = 0;
      payload.settled_at = null;
      payload.carryover_balance = (current.carryover_balance || 0) + (current.total_amount || 0);
    }

    const { data, error } = await supabase
      .from('settlements')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // audit_log
    await supabase.from('audit_logs').insert([{
      action: status === 'VOID' ? 'SETTLEMENT_VOID_ROLLBACK' : `SETTLEMENT_${status}`,
      target_type: 'settlement',
      target_id: id,
      description: status === 'VOID'
        ? `${(current.affiliates as any)?.name} ${current.settlement_period} 정산 원복 — booking_count 차감, 이월 복구`
        : `정산 상태 → ${status}`,
      before_value: { status: current.status, final_payout: current.final_payout, booking_count: (current.affiliates as any)?.booking_count },
      after_value: { status, final_payout: data?.final_payout },
    }]);

    return NextResponse.json({ settlement: data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '상태 변경 실패' }, { status: 500 });
  }
}
