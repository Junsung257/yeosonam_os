/**
 * GET /api/admin/ads-automation/status
 *
 * 광고 자동화 시스템의 현재 상태 한 화면 — 사장님이 어드민에서 진단용으로 사용.
 *
 * 반환:
 *   - 3 플랫폼 키 등록 여부 (Meta / 네이버 / 구글)
 *   - 자동 실행 토글 (APPLY_CHANGES, APPLY_OFFPEAK_RULE)
 *   - 광고 계정 잔액 + 일일 예산 (DB 최신값)
 *   - 키워드 통계 (ACTIVE / PAUSED / FLAGGED_UP / 롱테일)
 *   - 최근 24h 광고 지출·매출·순익
 */

import { NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { isMetaConfigured } from '@/lib/meta-api';
import { isNaverAdsConfigured, isGoogleAdsConfigured } from '@/lib/search-ads-api';
import { getAdAccounts } from '@/lib/db/ads';

export const dynamic = 'force-dynamic';

export async function GET() {
  const credentials = {
    meta: isMetaConfigured(),
    naver: isNaverAdsConfigured(),
    google: isGoogleAdsConfigured(),
  };

  const toggles = {
    applyChanges:
      process.env.AD_OPTIMIZER_APPLY_CHANGES === '1' ||
      process.env.AD_OPTIMIZER_APPLY_CHANGES === 'true',
    applyOffpeakRule:
      process.env.AD_OPTIMIZER_APPLY_OFFPEAK_RULE === '1' ||
      process.env.AD_OPTIMIZER_APPLY_OFFPEAK_RULE === 'true',
    roasTargetPct: Number(process.env.AD_ROAS_TARGET_PCT ?? 150),
    flagUpBidFactor: Number(process.env.AD_FLAG_UP_BID_FACTOR ?? 1.1),
    offpeakBidFactor: Number(process.env.AD_OFFPEAK_BID_FACTOR ?? 0.85),
    minBidKrw: Number(process.env.AD_MIN_BID_KRW ?? 70),
    longtailCpcMax: Number(process.env.AD_LONGTAIL_CPC_MAX ?? 100),
  };

  if (!isSupabaseConfigured) {
    return NextResponse.json({
      ok: true,
      mock: true,
      credentials,
      toggles,
      message: 'Supabase 미설정 — 자격 정보·토글 상태만 반환',
    });
  }

  try {
    const accounts = await getAdAccounts();

    // 키워드 통계 — status 별 카운트
    const { data: kwRows } = await supabaseAdmin
      .from('keyword_performances')
      .select('platform, status, is_longtail');
    const keywordStats = {
      total: kwRows?.length ?? 0,
      byStatus: { ACTIVE: 0, PAUSED: 0, FLAGGED_UP: 0 } as Record<string, number>,
      byPlatform: { naver: 0, google: 0, meta: 0 } as Record<string, number>,
      longtail: 0,
    };
    for (const row of (kwRows ?? []) as Array<{ platform: string; status: string; is_longtail: boolean }>) {
      keywordStats.byStatus[row.status] = (keywordStats.byStatus[row.status] ?? 0) + 1;
      keywordStats.byPlatform[row.platform] = (keywordStats.byPlatform[row.platform] ?? 0) + 1;
      if (row.is_longtail) keywordStats.longtail++;
    }

    // 오늘 광고 지출·매출 집계
    const today = new Date().toISOString().slice(0, 10);
    const { data: todayRows } = await supabaseAdmin
      .from('keyword_performances')
      .select('total_spend, total_revenue, net_profit, roas_pct')
      .eq('period_start', today);
    const todayStats = {
      totalSpend: 0,
      totalRevenue: 0,
      totalNetProfit: 0,
      avgRoas: 0,
    };
    for (const row of (todayRows ?? []) as Array<{ total_spend?: number; total_revenue?: number; net_profit?: number; roas_pct?: number }>) {
      todayStats.totalSpend += row.total_spend ?? 0;
      todayStats.totalRevenue += row.total_revenue ?? 0;
      todayStats.totalNetProfit += row.net_profit ?? 0;
    }
    todayStats.avgRoas =
      todayStats.totalSpend > 0
        ? Math.round((todayStats.totalRevenue / todayStats.totalSpend) * 100)
        : 0;

    // 잔액 부족 알림 최근 5건
    const { data: alerts } = await supabaseAdmin
      .from('admin_alerts')
      .select('id, severity, title, message, created_at')
      .eq('category', 'ad-balance')
      .order('created_at', { ascending: false })
      .limit(5);

    return NextResponse.json({
      ok: true,
      credentials,
      toggles,
      accounts: accounts.map((a) => ({
        platform: a.platform,
        accountName: a.account_name,
        currentBalance: a.current_balance,
        lowBalanceThreshold: a.low_balance_threshold,
        dailyBudget: a.daily_budget,
        lastSyncedAt: a.last_synced_at,
        isActive: a.is_active,
        belowThreshold: a.current_balance < a.low_balance_threshold,
      })),
      keywordStats,
      todayStats,
      recentBalanceAlerts: alerts ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : '상태 조회 실패',
        credentials,
        toggles,
      },
      { status: 500 },
    );
  }
}
