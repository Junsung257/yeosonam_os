/**
 * ══════════════════════════════════════════════════════════
 * 키워드 성과 통계 API — Phase 2
 * ══════════════════════════════════════════════════════════
 *
 * GET  /api/admin/keyword-stats
 *   - 전체 키워드 성과 요약 (총 지출, 클릭, 전환, ROAS)
 *   - 쿼리 파라미터: platform, dateFrom, dateTo, keyword
 *
 * GET  /api/admin/keyword-stats/top
 *   - 성과 상위/하위 키워드 랭킹
 *   - 쿼리 파라미터: platform, limit, orderBy (clicks|impressions|spend|roas)
 *
 * GET  /api/admin/keyword-stats/search-terms
 *   - 검색어 현황 + 누적 집계
 *   - 쿼리 파라미터: platform, dateFrom, dateTo, minImpressions
 *
 * 모두 CRON_SECRET Bearer 인증 필요
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { createClient } from '@supabase/supabase-js';
import { isAdminRequest } from '@/lib/admin-guard';

// ── Supabase 클라이언트 (서버 전용) ───────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── 인증 ─────────────────────────────────────────────────

async function verifyCronOrAdmin(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization');
  const cronSecret = getSecret('CRON_SECRET');
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  return isAdminRequest(req);
}

// ── 타입 ─────────────────────────────────────────────────

interface QueryParams {
  platform?: string;
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
  limit?: number;
}

// ── GET /api/admin/keyword-stats ─────────────────────────

export async function GET(req: NextRequest) {
  if (!(await verifyCronOrAdmin(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const path = searchParams.get('_path') || '';

  if (path === 'top') {
    return handleTopKeywords(req, supabase);
  }
  if (path === 'search-terms') {
    return handleSearchTerms(req, supabase);
  }

  return handleKeywordStats(req, supabase);
}

// ── 키워드 성과 요약 ────────────────────────────────────

async function handleKeywordStats(
  req: NextRequest,
  supabase: ReturnType<typeof getAdminClient>,
) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const keywordFilter = searchParams.get('keyword');

  let query = supabase!.from('keyword_performance_daily').select('*');

  if (platform) query = query.eq('platform', platform);
  if (dateFrom) query = query.gte('date', dateFrom);
  if (dateTo) query = query.lte('date', dateTo);
  if (keywordFilter) query = query.ilike('keyword', `%${keywordFilter}%`);

  const { data, error } = await query.order('date', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 집계
  const totalSpend = data?.reduce((s, r) => s + (r.spend || 0), 0) ?? 0;
  const totalClicks = data?.reduce((s, r) => s + (r.clicks || 0), 0) ?? 0;
  const totalImpressions = data?.reduce((s, r) => s + (r.impressions || 0), 0) ?? 0;
  const totalConversions = data?.reduce((s, r) => s + (r.conversions || 0), 0) ?? 0;

  // 고유 키워드 수
  const uniqueKeywords = new Set(data?.map((r) => r.keyword) ?? []);

  return NextResponse.json({
    summary: {
      totalRows: data?.length ?? 0,
      uniqueKeywords: uniqueKeywords.size,
      totalSpend,
      totalClicks,
      totalImpressions,
      totalConversions,
      ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
      cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      roas: totalSpend > 0 ? totalConversions / totalSpend : 0,
    },
    data,
  });
}

// ── 상위/하위 키워드 ────────────────────────────────────

async function handleTopKeywords(
  req: NextRequest,
  supabase: ReturnType<typeof getAdminClient>,
) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
  const orderBy = searchParams.get('orderBy') || 'spend';

  const allowedOrder = ['clicks', 'impressions', 'spend', 'roas', 'conversions', 'ctr', 'cpc'];
  if (!allowedOrder.includes(orderBy)) {
    return NextResponse.json({ error: `Invalid orderBy. Allowed: ${allowedOrder.join(', ')}` }, { status: 400 });
  }

  let query = supabase!.from('keyword_performance_daily').select('*');

  if (platform) query = query.eq('platform', platform);

  const { data, error } = await query.order(orderBy, { ascending: false }).limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 키워드별 집계
  const keywordMap = new Map<string, { impressions: number; clicks: number; spend: number; conversions: number; count: number }>();
  for (const row of data ?? []) {
    const k = row.keyword;
    const existing = keywordMap.get(k) ?? { impressions: 0, clicks: 0, spend: 0, conversions: 0, count: 0 };
    existing.impressions += row.impressions ?? 0;
    existing.clicks += row.clicks ?? 0;
    existing.spend += row.spend ?? 0;
    existing.conversions += row.conversions ?? 0;
    existing.count += 1;
    keywordMap.set(k, existing);
  }

  const ranked = Array.from(keywordMap.entries())
    .map(([keyword, stats]) => ({
      keyword,
      ...stats,
      ctr: stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : 0,
      cpc: stats.clicks > 0 ? stats.spend / stats.clicks : 0,
      roas: stats.spend > 0 ? stats.conversions / stats.spend : 0,
      daysActive: stats.count,
    }))
    .sort((a, b) => {
      const field = orderBy as keyof typeof a;
      return (b[field] as number) - (a[field] as number);
    })
    .slice(0, limit);

  return NextResponse.json({
    orderBy,
    top: ranked,
    bottom: ranked.slice().reverse().slice(0, Math.min(5, ranked.length)),
  });
}

// ── 검색어 현황 ────────────────────────────────────────

async function handleSearchTerms(
  req: NextRequest,
  supabase: ReturnType<typeof getAdminClient>,
) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const minImpressions = parseInt(searchParams.get('minImpressions') || '1');

  let query = supabase!.from('keyword_search_terms').select('*');

  if (platform) query = query.eq('platform', platform);
  if (dateFrom) query = query.gte('first_seen', dateFrom);
  if (dateTo) query = query.lte('first_seen', dateTo);
  query = query.gte('total_impressions', minImpressions);

  const { data, error } = await query
    .order('total_impressions', { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // negative 키워드 추천 (전환 0, 노출↑)
  const negativeCandidates = (data ?? [])
    .filter((t) => (t.total_conversions ?? 0) === 0 && (t.total_impressions ?? 0) >= 100)
    .map((t) => ({
      searchTerm: t.search_term,
      totalImpressions: t.total_impressions,
      totalSpend: t.total_spend,
    }))
    .sort((a, b) => b.totalImpressions - a.totalImpressions)
    .slice(0, 30);

  return NextResponse.json({
    totalSearchTerms: data?.length ?? 0,
    negativeCandidates,
    searchTerms: data,
  });
}
