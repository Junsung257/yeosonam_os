/**
 * Ad / Marketing — 캠페인 / 소재 / 성과 / 데이터 댐 / 키워드
 *
 * supabase.ts god 모듈에서 분리 (2026-04-27).
 * 호출자는 기존 그대로 `@/lib/supabase` 에서 import 가능 (re-export 유지).
 *
 * 통합 영역:
 *   - Meta Ads: AdCampaign / AdCreative / AdPerformanceSnapshot CRUD
 *   - 3대 광고 통합 데이터 댐: TrafficLog / SearchLog / EngagementLog / ConversionLog
 *   - AdAccount / KeywordPerformance / 마케팅 대시보드 KPI
 */

import type { AdCampaign, AdCreative, AdPerformanceSnapshot, CampaignStatus } from '@/types/meta-ads';
import { getSupabase } from '../supabase';

// ─── Meta Ads ────────────────────────────────────────────────

export async function getAdCampaigns(filters?: {
  packageId?: string;
  status?: CampaignStatus;
  page?: number;
  limit?: number;
}): Promise<AdCampaign[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase
    .from('ad_campaigns')
    .select('*, travel_packages(title, destination)')
    .order('created_at', { ascending: false });

  if (filters?.packageId) query = query.eq('package_id', filters.packageId);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.limit) query = query.limit(filters.limit);
  if (filters?.page && filters?.limit) {
    query = query.range((filters.page - 1) * filters.limit, filters.page * filters.limit - 1);
  }

  const { data } = await query;
  return (data ?? []).map((row: any) => ({
    ...row,
    package_title: row.travel_packages?.title,
    package_destination: row.travel_packages?.destination,
  }));
}

export async function upsertCampaign(data: Partial<AdCampaign> & { id?: string }): Promise<AdCampaign | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: result, error } = await supabase
    .from('ad_campaigns')
    .upsert({ ...data, updated_at: new Date().toISOString() } as never)
    .select()
    .single();

  if (error) throw new Error(`캠페인 저장 실패: ${error.message}`);
  return result as unknown as AdCampaign;
}

export async function saveCreatives(
  creatives: Omit<AdCreative, 'id' | 'created_at'>[]
): Promise<AdCreative[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('ad_creatives')
    .insert(creatives as never)
    .select();

  if (error) throw new Error(`소재 저장 실패: ${error.message}`);
  return (data ?? []) as unknown as AdCreative[];
}

export async function getAdCreatives(filters: {
  packageId?: string;
  campaignId?: string;
  platform?: string;
}): Promise<AdCreative[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase
    .from('ad_creatives')
    .select('*')
    .order('platform')
    .order('variant_index');

  if (filters.packageId) query = query.eq('package_id', filters.packageId);
  if (filters.campaignId) query = query.eq('campaign_id', filters.campaignId);
  if (filters.platform) query = query.eq('platform', filters.platform);

  const { data } = await query;
  return (data ?? []) as unknown as AdCreative[];
}

export async function upsertAdPerformanceSnapshot(
  snapshot: Omit<AdPerformanceSnapshot, 'id' | 'created_at'>
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  await supabase.from('ad_performance_snapshots').upsert(snapshot as never, {
    onConflict: 'campaign_id,snapshot_date',
  });
}

export async function getAdPerformance(
  campaignId: string,
  dateFrom?: string,
  dateTo?: string
): Promise<AdPerformanceSnapshot[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase
    .from('ad_performance_snapshots')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('snapshot_date', { ascending: false });

  if (dateFrom) query = query.gte('snapshot_date', dateFrom);
  if (dateTo) query = query.lte('snapshot_date', dateTo);

  const { data } = await query;
  return (data ?? []) as unknown as AdPerformanceSnapshot[];
}

export async function getTopCampaignsByRoas(limit = 3): Promise<AdCampaign[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: snapshots } = await supabase
    .from('ad_performance_snapshots')
    .select('campaign_id, spend_krw, attributed_margin')
    .gte('snapshot_date', sevenDaysAgo.toISOString().slice(0, 10));

  const byId = new Map<string, { spend: number; margin: number }>();
  for (const s of (snapshots ?? []) as { campaign_id: string; spend_krw: number; attributed_margin: number }[]) {
    const existing = byId.get(s.campaign_id) ?? { spend: 0, margin: 0 };
    byId.set(s.campaign_id, {
      spend: existing.spend + s.spend_krw,
      margin: existing.margin + s.attributed_margin,
    });
  }

  const ranked = Array.from(byId.entries())
    .map(([id, stats]) => ({
      id,
      roas: stats.spend > 0 ? (stats.margin / stats.spend) * 100 : 0,
    }))
    .sort((a, b) => b.roas - a.roas)
    .slice(0, limit);

  if (ranked.length === 0) return [];

  const { data: campaigns } = await supabase
    .from('ad_campaigns')
    .select('*, travel_packages(title, destination)')
    .in('id', ranked.map(r => r.id));

  return (campaigns ?? []).map((c: any) => ({
    ...c,
    package_title: c.travel_packages?.title,
    package_destination: c.travel_packages?.destination,
    latest_roas: ranked.find(r => r.id === c.id)?.roas ?? 0,
  }));
}

export async function getMetaCpcThreshold(): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 2000;

  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'meta_cpc_threshold')
    .single();

  const val = (data as { value?: string } | null)?.value;
  return val ? parseInt(val, 10) : 2000;
}

// ─── 3대 광고 통합 데이터 댐 ─────────────────────────────────

export interface AdTrafficLog {
  id: string;
  session_id: string;
  user_id?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign_name?: string | null;
  keyword?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  n_keyword?: string | null;
  current_cpc?: number | null;
  consent_agreed: boolean;
  landing_page?: string | null;
  content_creative_id?: string | null;
  created_at: string;
}

export interface AdSearchLog {
  id: string;
  session_id: string;
  user_id?: string | null;
  search_query?: string | null;
  search_category?: string | null;
  result_count?: number;
  lead_time_days?: number | null;
  created_at: string;
}

export interface AdEngagementLog {
  id: string;
  session_id: string;
  user_id?: string | null;
  event_type:
    | 'page_view'
    | 'product_view'
    | 'cart_added'
    | 'checkout_start'
    | 'scroll_25'
    | 'scroll_50'
    | 'scroll_75'
    | 'scroll_90'
    | string;
  product_id?: string | null;
  product_name?: string | null;
  cart_added: boolean;
  page_url?: string | null;
  lead_time_days?: number | null;
  created_at: string;
}

export interface AdConversionLog {
  id: string;
  session_id: string;
  user_id?: string | null;
  final_booking_id?: string | null;
  final_sales_price: number;
  base_cost: number;
  allocated_ad_spend: number;
  net_profit: number; // GENERATED ALWAYS
  attributed_source?: string | null;
  attributed_gclid?: string | null;
  attributed_fbclid?: string | null;
  first_touch_source?: string | null;
  first_touch_keyword?: string | null;
  first_touch_landing_page?: string | null;
  first_touch_creative_id?: string | null;
  first_touch_at?: string | null;
  content_creative_id?: string | null;
  created_at: string;
}

// ── INSERT 헬퍼 ──────────────────────────────────────────────

export async function insertTrafficLog(data: Omit<AdTrafficLog, 'id' | 'created_at'>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('ad_traffic_logs').insert(data as never);
}

export async function insertSearchLog(data: Omit<AdSearchLog, 'id' | 'created_at'>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('ad_search_logs').insert(data as never);
}

export async function insertEngagementLog(data: Omit<AdEngagementLog, 'id' | 'created_at'>): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('ad_engagement_logs').insert(data as never);
}

export async function insertConversionLog(
  data: Omit<AdConversionLog, 'id' | 'net_profit' | 'created_at'>
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('ad_conversion_logs').insert(data as never);
}

// ── QUERY 헬퍼 ───────────────────────────────────────────────

export async function getLatestTrafficBySession(session_id: string): Promise<AdTrafficLog | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('ad_traffic_logs')
    .select('*')
    .eq('session_id', session_id)
    .order('created_at', { ascending: false })
    .limit(1);
  return (data && data.length > 0) ? (data[0] as unknown as AdTrafficLog) : null;
}

/** First-touch: 해당 세션의 가장 첫 번째 유입 기록 */
export async function getFirstTrafficBySession(session_id: string): Promise<AdTrafficLog | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from('ad_traffic_logs')
    .select('*')
    .eq('session_id', session_id)
    .order('created_at', { ascending: true })
    .limit(1);
  return (data && data.length > 0) ? (data[0] as unknown as AdTrafficLog) : null;
}

export async function mergeSessionToUser(session_id: string, user_id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await Promise.all([
    sb.from('ad_traffic_logs')
      .update({ user_id } as never)
      .eq('session_id', session_id)
      .is('user_id', null),
    sb.from('ad_search_logs')
      .update({ user_id } as never)
      .eq('session_id', session_id)
      .is('user_id', null),
    sb.from('ad_engagement_logs')
      .update({ user_id } as never)
      .eq('session_id', session_id)
      .is('user_id', null),
  ]);
}

// ─── AdAccount / KeywordPerformance ──────────────────────────

export interface AdAccount {
  id: string;
  platform: 'naver' | 'google' | 'meta';
  account_name: string;
  current_balance: number;
  daily_budget: number;
  low_balance_threshold: number;
  is_active: boolean;
  last_synced_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeywordPerformance {
  id: string;
  platform: 'naver' | 'google' | 'meta';
  keyword: string;
  ad_account_id?: string | null;
  total_spend: number;
  total_revenue: number;
  total_cost: number;
  net_profit: number;   // GENERATED ALWAYS
  roas_pct: number;     // GENERATED ALWAYS
  status: 'ACTIVE' | 'PAUSED' | 'FLAGGED_UP';
  current_bid: number;
  clicks: number;
  impressions: number;
  conversions: number;
  is_longtail: boolean;
  discovered_at?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  updated_at: string;
}

// ── AdAccount CRUD ──────────────────────────────────────────────

export async function getAdAccounts(): Promise<AdAccount[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from('ad_accounts').select('*').eq('is_active', true);
  return (data ?? []) as AdAccount[];
}

export async function updateAdAccountBalance(
  id: string,
  balance: number
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('ad_accounts').update({
    current_balance: balance,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as never).eq('id', id);
}

// ── KeywordPerformance CRUD ─────────────────────────────────────

export async function getKeywordPerformances(params?: {
  platform?: string;
  status?: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<KeywordPerformance[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from('keyword_performances').select('*');
  if (params?.platform) q = q.eq('platform', params.platform);
  if (params?.status)   q = q.eq('status', params.status);
  if (params?.periodStart) q = q.gte('period_start', params.periodStart);
  if (params?.periodEnd)   q = q.lte('period_end', params.periodEnd);
  const { data } = await q.order('net_profit', { ascending: false });
  return (data ?? []) as KeywordPerformance[];
}

export async function updateKeywordStatus(
  id: string,
  status: 'ACTIVE' | 'PAUSED' | 'FLAGGED_UP'
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('keyword_performances').update({
    status,
    updated_at: new Date().toISOString(),
  } as never).eq('id', id);
}

export async function updateKeywordBid(
  id: string,
  currentBid: number,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('keyword_performances').update({
    current_bid: currentBid,
    updated_at: new Date().toISOString(),
  } as never).eq('id', id);
}

export async function upsertKeywordPerformance(
  data: Omit<KeywordPerformance, 'id' | 'net_profit' | 'roas_pct' | 'updated_at'>
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('keyword_performances').upsert(
    { ...data, updated_at: new Date().toISOString() } as never,
    { onConflict: 'platform,keyword' }
  );
}

/** 오늘 날짜 기준 총 광고 지출 및 전환 매출 집계 */
export async function getAdDashboardStats(date?: string): Promise<{
  total_spend: number;
  total_revenue: number;
  total_cost: number;
  total_net_profit: number;
}> {
  const sb = getSupabase();
  if (!sb) return { total_spend: 0, total_revenue: 0, total_cost: 0, total_net_profit: 0 };
  const today = date ?? new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from('keyword_performances')
    .select('total_spend, total_revenue, total_cost, net_profit')
    .eq('period_start', today);
  const rows = (data ?? []) as Pick<KeywordPerformance, 'total_spend' | 'total_revenue' | 'total_cost' | 'net_profit'>[];
  return {
    total_spend:      rows.reduce((s, r) => s + r.total_spend, 0),
    total_revenue:    rows.reduce((s, r) => s + r.total_revenue, 0),
    total_cost:       rows.reduce((s, r) => s + r.total_cost, 0),
    total_net_profit: rows.reduce((s, r) => s + r.net_profit, 0),
  };
}
