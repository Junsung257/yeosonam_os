import { NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { ADMIN_CACHE } from '@/lib/admin-cache';
import {
  buildMarketingOperationsDashboard,
  type AccountRow,
  type BookingRow,
  type CampaignRow,
  type ChannelHealthRow,
  type CreativeRow,
  type DistributionRow,
  type EngagementRow,
  type LeadRow,
  type PerformanceRow,
  type RecommendationRow,
  type TrafficRow,
} from '@/lib/marketing';

export const dynamic = 'force-dynamic';

type QueryError = {
  code?: string | null;
  message?: string | null;
};

function assertQuerySucceeded(name: string, error: QueryError | null): void {
  if (!error) return;
  const code = error.code ? `:${error.code}` : '';
  throw new Error(`MARKETING_DASHBOARD_QUERY_FAILED:${name}${code}`);
}

function parseDays(request: NextRequest): number {
  const requested = Number.parseInt(request.nextUrl.searchParams.get('days') ?? '30', 10);
  if (!Number.isFinite(requested)) return 30;
  return [7, 30, 90].includes(requested) ? requested : 30;
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured) {
    return apiResponse({
      ok: false,
      error: {
        code: 'MARKETING_DATA_UNAVAILABLE',
        message: '마케팅 데이터를 읽을 수 있도록 데이터베이스 연결이 필요합니다.',
      },
    }, { status: 503, headers: ADMIN_CACHE.noCache });
  }

  const days = parseDays(request);
  const collectedAt = new Date().toISOString();
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const fromIso = from.toISOString();
  const fromDate = fromIso.slice(0, 10);

  try {
    const [
      trafficResult,
      latestTrafficResult,
      engagementResult,
      leadResult,
      bookingResult,
      settledBookingResult,
      campaignResult,
      performanceResult,
      channelHealthResult,
      accountResult,
      recommendationResult,
      creativeResult,
      distributionResult,
    ] = await Promise.all([
      supabaseAdmin
        .from('ad_traffic_logs')
        .select('source, medium, gclid, fbclid, n_keyword, created_at', { count: 'exact' })
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from('ad_traffic_logs')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1),
      supabaseAdmin
        .from('ad_engagement_logs')
        .select('event_type, created_at')
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from('leads')
        .select('utm_source, channel, created_at, submitted_at')
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(2000),
      supabaseAdmin
        .from('bookings')
        .select('id, utm_source, channel_source, status, payment_status, margin, settlement_confirmed_at, created_at')
        .gte('created_at', fromIso)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('created_at', { ascending: false })
        .limit(2000),
      supabaseAdmin
        .from('bookings')
        .select('id, utm_source, channel_source, status, payment_status, margin, settlement_confirmed_at, created_at')
        .gte('settlement_confirmed_at', fromIso)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('settlement_confirmed_at', { ascending: false })
        .limit(2000),
      supabaseAdmin
        .from('ad_campaigns')
        .select('id, name, channel, status, daily_budget_krw, meta_campaign_id, naver_campaign_id, google_campaign_id, updated_at')
        .order('updated_at', { ascending: false })
        .limit(500),
      supabaseAdmin
        .from('ad_performance_snapshots')
        .select('campaign_id, snapshot_date, impressions, clicks, spend_krw, attributed_bookings, attributed_margin')
        .gte('snapshot_date', fromDate)
        .order('snapshot_date', { ascending: false })
        .limit(5000),
      supabaseAdmin
        .from('ad_os_channel_adapter_health')
        .select('platform, adapter_state, credentials_ready, permission_ready, campaign_ready, budget_ready, conversion_ready, live_publish_enabled, external_api_write, recommended_action, checked_at')
        .order('checked_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('ad_os_tenant_ad_accounts')
        .select('platform, connection_status, external_account_id, external_campaign_id, last_probe_at, risk_status')
        .order('updated_at', { ascending: false })
        .limit(50),
      supabaseAdmin
        .from('marketing_recommendations')
        .select('id, severity, title, reason, action_url, action_label, status, updated_at')
        .in('status', ['open', 'pending'])
        .order('updated_at', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('content_creatives')
        .select('status, channel, published_at, created_at')
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(2000),
      supabaseAdmin
        .from('content_distributions')
        .select('platform, status, published_at, scheduled_for, updated_at, error_message')
        .gte('updated_at', fromIso)
        .order('updated_at', { ascending: false })
        .limit(2000),
    ]);

    const results = [
      ['traffic', trafficResult.error],
      ['latest_traffic', latestTrafficResult.error],
      ['engagement', engagementResult.error],
      ['leads', leadResult.error],
      ['bookings', bookingResult.error],
      ['settled_bookings', settledBookingResult.error],
      ['campaigns', campaignResult.error],
      ['performance', performanceResult.error],
      ['channel_health', channelHealthResult.error],
      ['accounts', accountResult.error],
      ['recommendations', recommendationResult.error],
      ['creatives', creativeResult.error],
      ['distributions', distributionResult.error],
    ] as const;
    for (const [name, error] of results) assertQuerySucceeded(name, error);

    const traffic = (trafficResult.data ?? []).map((row) => ({
      ...row,
      gbraid: null,
      wbraid: null,
    })) as TrafficRow[];
    const engagements = (engagementResult.data ?? []).map((row) => ({
      ...row,
      event_source: null,
    })) as EngagementRow[];
    const latestTrackingAt = (
      latestTrafficResult.data?.[0] as { created_at?: string } | undefined
    )?.created_at ?? null;

    const data = buildMarketingOperationsDashboard({
      days,
      collectedAt,
      trafficCount: trafficResult.count ?? traffic.length,
      latestTrackingAt,
      traffic,
      engagements,
      leads: (leadResult.data ?? []) as LeadRow[],
      bookings: (bookingResult.data ?? []) as BookingRow[],
      settledBookings: (settledBookingResult.data ?? []) as BookingRow[],
      campaigns: (campaignResult.data ?? []) as CampaignRow[],
      performance: (performanceResult.data ?? []) as PerformanceRow[],
      channelHealth: (channelHealthResult.data ?? []) as ChannelHealthRow[],
      accounts: (accountResult.data ?? []) as AccountRow[],
      recommendations: (recommendationResult.data ?? []) as RecommendationRow[],
      creatives: (creativeResult.data ?? []) as CreativeRow[],
      distributions: (distributionResult.data ?? []) as DistributionRow[],
    });

    return apiResponse({ ok: true, data }, { headers: ADMIN_CACHE.analytics });
  } catch (error) {
    console.error('[marketing-dashboard] 집계 실패:', sanitizeDbError(error));
    return apiResponse({
      ok: false,
      error: {
        code: 'MARKETING_DASHBOARD_FAILED',
        message: '마케팅 현황을 불러오지 못했습니다. 시스템 상태에서 연결을 확인해 주세요.',
      },
    }, { status: 500, headers: ADMIN_CACHE.noCache });
  }
}

export const GET = withAdminGuard(getHandler);
