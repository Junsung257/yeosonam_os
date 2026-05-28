/**
 * 마일리지 통계/분석 API (Admin 전용)
 *
 * GET /api/mileage/analytics
 *   → { totalBalance, customerCount, avgMileage,
 *       monthlyData, gradeDistribution,
 *       mileageUsageRate, totalEarnedAllTime, totalExpiredAllTime }
 *
 * 보안: Admin 세션 필요
 * (민감 데이터 — 전체 고객 마일리지/등급 정보 포함)
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { isSupabaseConfigured, supabaseAdmin, supabase } = await import('@/lib/supabase');

    if (!isSupabaseConfigured) {
      return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
    }

    // ── Admin 인증 ─────────────────────────────────────────────
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

    // ── 데이터 수집 (단일 패스) ────────────────────────────────
    // 1. 고객 데이터 (마일리지 + 등급)
    const { data: customers } = await supabaseAdmin
      .from('customers')
      .select('id, grade, mileage, name');

    if (!customers || customers.length === 0) {
      return NextResponse.json({
        totalBalance: 0,
        customerCount: 0,
        avgMileage: 0,
        monthlyData: [],
        gradeDistribution: [],
        mileageUsageRate: 0,
        totalEarnedAllTime: 0,
        totalExpiredAllTime: 0,
      });
    }

    const totalBalance = customers.reduce((s: number, c: any) => s + (c.mileage || 0), 0);
    const customerCount = customers.length;
    const avgMileage = Math.round(totalBalance / customerCount);

    // 2. 등급별 분포
    const gradeMap = new Map<string, { count: number; total: number }>();
    for (const c of customers as Array<{ grade: string | null; mileage: number }>) {
      const grade = c.grade || '일반';
      const prev = gradeMap.get(grade) || { count: 0, total: 0 };
      prev.count++;
      prev.total += c.mileage || 0;
      gradeMap.set(grade, prev);
    }
    const gradeDistribution = Array.from(gradeMap.entries()).map(([grade, data]) => ({
      grade,
      count: data.count,
      totalMileage: data.total,
      avgMileage: Math.round(data.total / data.count),
    }));

    // 3. 전체 기간 통계 (단일 쿼리)
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const { data: recentTransactions } = await supabaseAdmin
      .from('mileage_transactions')
      .select('amount, type, created_at')
      .gte('created_at', twelveMonthsAgo.toISOString());

    const { data: allTransactions } = await supabaseAdmin
      .from('mileage_transactions')
      .select('amount, type');

    // 4. 월별 데이터
    const monthlyMap = new Map<string, { earned: number; used: number; expired: number }>();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(key, { earned: 0, used: 0, expired: 0 });
    }

    if (recentTransactions) {
      for (const tx of recentTransactions as Array<{ amount: number; type: string; created_at: string }>) {
        const d = new Date(tx.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const entry = monthlyMap.get(key);
        if (!entry) continue;

        if (tx.type === 'EARNED' && tx.amount > 0) entry.earned += tx.amount;
        else if (tx.type === 'USED') entry.used += Math.abs(tx.amount);
        else if (tx.type === 'EXPIRED') entry.expired += Math.abs(tx.amount);
      }
    }

    const monthlyData = Array.from(monthlyMap.entries()).map(([month, data]) => ({
      month,
      ...data,
    }));

    // 5. 전체 기간 통계
    let totalEarnedAllTime = 0;
    let totalExpiredAllTime = 0;
    if (allTransactions) {
      for (const tx of allTransactions as Array<{ amount: number; type: string }>) {
        if (tx.type === 'EARNED' && tx.amount > 0) totalEarnedAllTime += tx.amount;
        else if (tx.type === 'EXPIRED') totalExpiredAllTime += Math.abs(tx.amount);
      }
    }

    // 6. 마일리지 사용률 (적립 대비 잔액)
    const usageRate =
      totalEarnedAllTime > 0
        ? ((totalEarnedAllTime - totalBalance) / totalEarnedAllTime) * 100
        : 0;

    return NextResponse.json({
      totalBalance,
      customerCount,
      avgMileage,
      monthlyData,
      gradeDistribution: gradeDistribution.sort((a, b) => b.totalMileage - a.totalMileage),
      mileageUsageRate: parseFloat(usageRate.toFixed(1)),
      totalEarnedAllTime,
      totalExpiredAllTime,
    });
  } catch (error) {
    console.error('[MileageAnalytics] API 오류:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
