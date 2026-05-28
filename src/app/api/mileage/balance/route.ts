/**
 * 마일리지 잔액 조회 API
 *
 * GET /api/mileage/balance
 *   → { balance: number, grade: string, totalEarned: number, totalUsed: number }
 *
 * 인증: 세션 기반 (로그인 사용자)
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // ── 세션 확인 ────────────────────────────────────────────
    const { supabase } = await import('@/lib/supabase');
    const sb = await supabase();
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── 고객 정보 조회 ──────────────────────────────────────
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('grade, mileage, total_spent')
      .eq('id', user.id)
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const cust = customer as { grade: string; mileage: number; total_spent: number };

    // ── 거래 내역 통계 ──────────────────────────────────────
    const { data: earnedData } = await supabaseAdmin
      .from('mileage_transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'EARNED');

    const { data: usedData } = await supabaseAdmin
      .from('mileage_transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'USED');

    const totalEarned = (earnedData ?? []).reduce((sum: number, t: { amount: number }) => sum + t.amount, 0);
    const totalUsed = (usedData ?? []).reduce((sum: number, t: { amount: number }) => sum + Math.abs(t.amount), 0);

    return NextResponse.json({
      balance: cust.mileage,
      grade: cust.grade,
      totalEarned,
      totalUsed,
      totalSpent: cust.total_spent,
    });
  } catch (error) {
    console.error('[Mileage/Balance] 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
