import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  getAdAccounts,
  getKeywordPerformances,
  getAdDashboardStats,
  type KeywordPerformance,
} from '@/lib/supabase';
import { calcRoas, classifyKeywordStatus } from '@/lib/ad-controller';

// ── Mock 데이터 ───────────────────────────────────────────────

const MOCK_KEYWORDS: KeywordPerformance[] = [
  {
    id: 'kw-1', platform: 'naver', keyword: '발리 단체여행',
    total_spend: 120000, total_revenue: 3600000, total_cost: 2800000,
    net_profit: 680000, roas_pct: 300, status: 'FLAGGED_UP',
    current_bid: 250, clicks: 48, impressions: 1200, conversions: 3,
    is_longtail: false, updated_at: new Date().toISOString(),
  },
  {
    id: 'kw-2', platform: 'naver', keyword: '태국 패키지',
    total_spend: 200000, total_revenue: 2200000, total_cost: 1900000,
    net_profit: 100000, roas_pct: 110, status: 'PAUSED',
    current_bid: 180, clicks: 33, impressions: 900, conversions: 2,
    is_longtail: false, updated_at: new Date().toISOString(),
  },
  {
    id: 'kw-3', platform: 'google', keyword: '유럽 허니문 여행사',
    total_spend: 80000, total_revenue: 5000000, total_cost: 3500000,
    net_profit: 1420000, roas_pct: 625, status: 'FLAGGED_UP',
    current_bid: 320, clicks: 25, impressions: 600, conversions: 1,
    is_longtail: false, updated_at: new Date().toISOString(),
  },
  {
    id: 'kw-4', platform: 'meta', keyword: '단체 해외여행 견적',
    total_spend: 50000, total_revenue: 0, total_cost: 0,
    net_profit: -50000, roas_pct: 0, status: 'PAUSED',
    current_bid: 0, clicks: 5, impressions: 3000, conversions: 0,
    is_longtail: false, updated_at: new Date().toISOString(),
  },
  {
    id: 'kw-5', platform: 'naver', keyword: '발리 4박5일 저렴한',
    total_spend: 20000, total_revenue: 0, total_cost: 0,
    net_profit: -20000, roas_pct: 0, status: 'ACTIVE',
    current_bid: 75, clicks: 3, impressions: 200, conversions: 0,
    is_longtail: true, updated_at: new Date().toISOString(),
  },
];

function buildMockDashboard(dateParam: string | null) {
  const keywords = MOCK_KEYWORDS;
  const totalSpend      = keywords.reduce((s, k) => s + k.total_spend, 0);
  const totalRevenue    = keywords.reduce((s, k) => s + k.total_revenue, 0);
  const totalNetProfit  = keywords.reduce((s, k) => s + k.net_profit, 0);
  const overallRoas     = calcRoas(totalRevenue, totalSpend);

  return {
    date: dateParam ?? new Date().toISOString().slice(0, 10),
    kpis: {
      total_spend:      totalSpend,
      total_revenue:    totalRevenue,
      total_net_profit: totalNetProfit,
      overall_roas_pct: overallRoas,
    },
    ad_accounts: [
      { platform: 'naver',  account_name: '여소남_네이버', current_balance: 120000, daily_budget: 300000, low_balance: false },
      { platform: 'google', account_name: '여소남_구글',   current_balance: 85000,  daily_budget: 200000, low_balance: false },
      { platform: 'meta',   account_name: '여소남_메타',   current_balance: 43000,  daily_budget: 150000, low_balance: true },
    ],
    keywords: buildKeywordTable(keywords),
    mock: true,
  };
}

// ── 키워드 테이블 3분류 처리 ──────────────────────────────────

function buildKeywordTable(keywords: KeywordPerformance[]) {
  const withClassification = keywords.map((k) => ({
    ...k,
    classification: classifyKeywordStatus(k.roas_pct, k.net_profit, k.clicks),
  }));

  return {
    revenue_generating: withClassification.filter((k) => k.classification === '수익발생'),
    spending_only:      withClassification.filter((k) => k.classification === '돈만씀'),
    insufficient_data:  withClassification.filter((k) => k.classification === '데이터부족'),
    all:                withClassification,
  };
}

// ── GET /api/admin/dashboard ──────────────────────────────────
/**
 * 사장의 관제실 대시보드 API
 *
 * Query params:
 *   ?date=YYYY-MM-DD  (기본: 오늘)
 *   ?platform=naver|google|meta  (기본: 전체)
 *   ?filter=revenue_generating|spending_only|insufficient_data|all  (기본: all)
 *
 * Response:
 *   kpis: { total_spend, total_revenue, total_net_profit, overall_roas_pct }
 *   ad_accounts: 플랫폼별 잔액 현황 + low_balance 경고 플래그
 *   keywords: { revenue_generating[], spending_only[], insufficient_data[], all[] }
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const dateParam     = searchParams.get('date');
  const platformParam = searchParams.get('platform') ?? undefined;
  const filterParam   = searchParams.get('filter') ?? 'all';

  if (!isSupabaseConfigured) {
    const mock = buildMockDashboard(dateParam);
    // filter 파라미터 적용
    if (filterParam !== 'all' && filterParam in mock.keywords) {
      return NextResponse.json({
        ...mock,
        keywords: {
          ...mock.keywords,
          filtered: mock.keywords[filterParam as keyof typeof mock.keywords],
          active_filter: filterParam,
        },
      });
    }
    return NextResponse.json(mock);
  }

  // ── 실제 Supabase 데이터 ────────────────────────────────────

  const [adAccounts, keywords, stats] = await Promise.all([
    getAdAccounts(),
    getKeywordPerformances({
      platform: platformParam,
      periodStart: dateParam ?? new Date().toISOString().slice(0, 10),
      periodEnd: dateParam ?? new Date().toISOString().slice(0, 10),
    }),
    getAdDashboardStats(dateParam ?? undefined),
  ]);

  // 광고 계정 잔액 부족 경고 플래그
  const accountsWithAlert = adAccounts.map((acc) => ({
    platform: acc.platform,
    account_name: acc.account_name,
    current_balance: acc.current_balance,
    daily_budget: acc.daily_budget,
    low_balance: acc.current_balance <= acc.low_balance_threshold,
    last_synced_at: acc.last_synced_at,
  }));

  // 통합 ROAS
  const overallRoas = calcRoas(stats.total_revenue, stats.total_spend);

  const keywordTable = buildKeywordTable(keywords);

  // filter 파라미터 적용
  const filteredKeywords =
    filterParam !== 'all' && filterParam in keywordTable
      ? keywordTable[filterParam as keyof typeof keywordTable]
      : keywordTable.all;

  return NextResponse.json({
    date: dateParam ?? new Date().toISOString().slice(0, 10),
    kpis: {
      total_spend:      stats.total_spend,
      total_revenue:    stats.total_revenue,
      total_net_profit: stats.total_net_profit,
      overall_roas_pct: overallRoas,
    },
    ad_accounts: accountsWithAlert,
    keywords: {
      ...keywordTable,
      filtered: filteredKeywords,
      active_filter: filterParam,
    },
  });
}
