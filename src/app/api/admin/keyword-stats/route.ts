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

import { NextRequest } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { createClient } from '@supabase/supabase-js';
import { isAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

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
    return apiResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return apiResponse({ error: 'Supabase not configured' }, { status: 503 });
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

  const { data, error } = await supabase!.rpc('get_keyword_performance_admin_summary', {
    p_platform: platform || null,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
    p_keyword: keywordFilter || null,
  });

  if (error) {
    if ((error.code === 'PGRST205' || error.code === 'PGRST202') && error.message.includes('keyword')) {
      return apiResponse({
        available: false,
        reason: '검색광고 성과 테이블이 아직 연결되지 않았습니다.',
        data: [],
      });
    }
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  return apiResponse({
    available: true,
    summary: data,
    data: [],
    partial: false,
  });
}

// ── 상위/하위 키워드 ────────────────────────────────────

async function handleTopKeywords(
  req: NextRequest,
  supabase: ReturnType<typeof getAdminClient>,
) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform');
  const requestedLimit = Number.parseInt(searchParams.get('limit') || '20', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
  const orderBy = searchParams.get('orderBy') || 'spend';

  const allowedOrder = ['clicks', 'impressions', 'spend', 'roas', 'conversions', 'ctr', 'cpc'];
  if (!allowedOrder.includes(orderBy)) {
    return apiResponse({ error: `Invalid orderBy. Allowed: ${allowedOrder.join(', ')}` }, { status: 400 });
  }

  const orderColumn: Record<string, string> = {
    clicks: 'clicks', impressions: 'impressions', spend: 'cost_krw', roas: 'roas',
    conversions: 'conversions', ctr: 'ctr', cpc: 'avg_cpc',
  };
  const fields = 'keyword_text, platform, impressions, clicks, cost_krw, conversions, conversion_value, days_active, ctr, avg_cpc, roas';
  let topQuery = supabase!.from('v_keyword_performance_summary').select(fields, { count: 'exact' });
  let bottomQuery = supabase!.from('v_keyword_performance_summary').select(fields);
  if (platform) {
    topQuery = topQuery.eq('platform', platform);
    bottomQuery = bottomQuery.eq('platform', platform);
  }
  const [topResult, bottomResult] = await Promise.all([
    topQuery.order(orderColumn[orderBy], { ascending: false }).limit(limit),
    bottomQuery.order(orderColumn[orderBy], { ascending: true }).limit(5),
  ]);

  if (topResult.error || bottomResult.error) {
    return apiResponse({ error: sanitizeDbError(topResult.error || bottomResult.error) }, { status: 500 });
  }

  const normalizeRanking = (row: Record<string, unknown>) => ({
    keyword: String(row.keyword_text || '(키워드 없음)'),
    platform: String(row.platform || 'unknown'),
    impressions: Number(row.impressions) || 0,
    clicks: Number(row.clicks) || 0,
    spend: Number(row.cost_krw) || 0,
    conversions: Number(row.conversions) || 0,
    ctr: Number(row.ctr) || 0,
    cpc: Number(row.avg_cpc) || 0,
    roas: Number(row.roas) || 0,
    daysActive: Number(row.days_active) || 0,
  });

  const ranked = (topResult.data ?? []).map(row => normalizeRanking(row));
  const bottom = (bottomResult.data ?? []).map(row => normalizeRanking(row));

  return apiResponse({
    orderBy,
    top: ranked,
    bottom,
    partial: false,
    totalRowsAvailable: topResult.count ?? topResult.data?.length ?? 0,
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
  const requestedMinImpressions = Number.parseInt(searchParams.get('minImpressions') || '1', 10);
  const minImpressions = Number.isFinite(requestedMinImpressions) ? Math.max(0, requestedMinImpressions) : 1;

  let query = supabase!.from('keyword_search_terms').select('*');

  if (platform) query = query.eq('platform', platform);
  if (dateFrom) query = query.gte('first_seen', dateFrom);
  if (dateTo) query = query.lte('first_seen', dateTo);
  query = query.gte('impressions', minImpressions);

  const { data, error } = await query
    .order('impressions', { ascending: false })
    .limit(500);

  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  // negative 키워드 추천 (전환 0, 노출↑)
  const negativeCandidates = (data ?? [])
    .filter((t) => (t.conversions ?? 0) === 0 && (t.impressions ?? 0) >= 100)
    .map((t) => ({
      searchTerm: t.search_term,
      totalImpressions: t.impressions,
      totalSpend: t.cost_krw,
    }))
    .sort((a, b) => b.totalImpressions - a.totalImpressions)
    .slice(0, 30);

  return apiResponse({
    totalSearchTerms: data?.length ?? 0,
    negativeCandidates,
    searchTerms: data,
  });
}
