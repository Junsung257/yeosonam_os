/**
 * 마일리지 분석 데이터 API (Admin 전용)
 *
 * GET /api/admin/mileage-analytics?period=this_month
 *   → { totalEarned, totalUsed, totalExpired, totalBalance, gradeDistribution, monthlyTrend, topEarners }
 *
 * 보안: admin 세션 필요
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // ── Admin 인증 ───────────────────────────────────────────
    const { supabase } = await import('@/lib/supabase');
    const sb = await supabase();
    const { data: { user } } = await sb.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: admin } = await supabaseAdmin
      .from('admins')
      .select('id')
      .eq('id', user.id)
      .single();

    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── 기간 설정 ────────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') ?? 'this_month';

    const now = new Date();
    let since: Date;
    switch (period) {
      case 'last_month':
        since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        break;
      case 'this_quarter':
        since = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        break;
      case 'this_year':
        since = new Date(now.getFullYear(), 0, 1);
        break;
      case 'all':
        since = new Date(2020, 0, 1);
        break;
      default: // this_month
        since = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const sinceStr = since.toISOString();

    // ── 기간 내 통계 (단일 쿼리: 조건에 맞는 모든 트랜잭션) ──
    const { data: periodTransactions } = await supabaseAdmin
      .from('mileage_transactions')
      .select('amount, type, user_id')
      .gte('created_at', sinceStr);

    let totalEarned = 0;
    let totalUsed = 0;
    let totalExpired = 0;
    let clawbackTotal = 0;
    let earnedCount = 0;
    let usedCount = 0;

    // topEarner 집계용
    const earnerMap = new Map<string, number>();

    for (const tx of (periodTransactions ?? []) as Array<{ amount: number; type: string; user_id: string }>) {
      if (tx.type === 'EARNED' && tx.amount > 0) {
        totalEarned += tx.amount;
        earnedCount++;
        earnerMap.set(tx.user_id, (earnerMap.get(tx.user_id) || 0) + tx.amount);
      } else if (tx.type === 'USED') {
        totalUsed += Math.abs(tx.amount);
        usedCount++;
      } else if (tx.type === 'EXPIRED') {
        totalExpired += Math.abs(tx.amount);
      } else if (tx.type === 'CLAWBACK') {
        clawbackTotal += Math.abs(tx.amount);
      }
    }

    // ── 전체 잔액 + 등급 분포 (단일 쿼리) ─────────────────────
    const { data: customerData } = await supabaseAdmin
      .from('customers')
      .select('mileage, grade');

    let totalBalance = 0;
    let activeCustomers = 0;
    const gradeMap = new Map<string, { count: number; totalMileage: number }>();

    for (const c of (customerData ?? []) as Array<{ mileage: number | null; grade: string | null }>) {
      const m = c.mileage || 0;
      totalBalance += m;
      if (m > 0) activeCustomers++;
      const g = c.grade || '신규';
      const existing = gradeMap.get(g) ?? { count: 0, totalMileage: 0 };
      existing.count++;
      existing.totalMileage += m;
      gradeMap.set(g, existing);
    }

    const gradeDistribution = Array.from(gradeMap.entries())
      .map(([grade, v]) => ({
        grade,
        count: v.count,
        totalMileage: v.totalMileage,
      }))
      .sort((a, b) => b.totalMileage - a.totalMileage);

    // ── 월별 추이 (최근 6개월, 단일 쿼리) ─────────────────────
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const { data: trendTransactions } = await supabaseAdmin
      .from('mileage_transactions')
      .select('amount, type, created_at')
      .or('type.eq.EARNED,type.eq.USED')
      .gte('created_at', sixMonthsAgo.toISOString());

    const trendMap = new Map<string, { earned: number; used: number }>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      trendMap.set(key, { earned: 0, used: 0 });
    }

    if (trendTransactions) {
      for (const tx of trendTransactions as Array<{ amount: number; type: string; created_at: string }>) {
        const d = new Date(tx.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const entry = trendMap.get(key);
        if (!entry) continue;
        if (tx.type === 'EARNED' && tx.amount > 0) entry.earned += tx.amount;
        else if (tx.type === 'USED') entry.used += Math.abs(tx.amount);
      }
    }

    const monthlyTrend = Array.from(trendMap.entries()).map(([month, data]) => ({
      month,
      ...data,
    }));

    // ── TOP 적립 고객 ────────────────────────────────────────
    const topEarnerIds = Array.from(earnerMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    const { data: topEarnerCustomers } = await supabaseAdmin
      .from('customers')
      .select('id, name')
      .in('id', topEarnerIds);

    const customerNameMap = new Map<string, string>();
    for (const c of (topEarnerCustomers ?? []) as Array<{ id: string; name: string }>) {
      customerNameMap.set(c.id, c.name || '(이름 없음)');
    }

    const topEarners = Array.from(earnerMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, earned]) => ({
        customerName: customerNameMap.get(id) || id.slice(0, 8),
        earned,
      }));

    return NextResponse.json({
      period,
      totalEarned,
      totalUsed,
      totalExpired,
      clawbackTotal,
      totalBalance,
      earnedCount,
      usedCount,
      activeCustomers,
      gradeDistribution,
      monthlyTrend,
      topEarners,
    });
  } catch (error) {
    console.error('[MileageAnalytics] 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
