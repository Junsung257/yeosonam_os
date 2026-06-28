import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function isoDateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function sum(rows: Array<Record<string, unknown>>, key: string): number {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase admin is not configured.' }, { status: 503 });
  }

  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') || 30), 1), 365);
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 200), 1), 1000);
  const platform = request.nextUrl.searchParams.get('channel');
  const productId = request.nextUrl.searchParams.get('product');
  const tenantId = request.nextUrl.searchParams.get('tenant');

  let query = supabaseAdmin
    .from('ad_os_performance_facts')
    .select(`
      id, tenant_id, product_id, scenario_id, ad_landing_mapping_id,
      content_creative_id, ad_campaign_id, ad_creative_id, platform,
      keyword_text, search_term, source, event_date, impressions, clicks,
      cost_krw, cta_clicks, conversions, revenue_krw, margin_krw,
      bounces, sessions, avg_time_on_page_seconds, avg_scroll_depth_pct, metrics
    `)
    .gte('event_date', isoDateDaysAgo(days))
    .order('event_date', { ascending: false })
    .limit(limit);

  if (platform) query = query.eq('platform', platform);
  if (productId) query = query.eq('product_id', productId);
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const facts = (data || []) as Array<Record<string, unknown>>;
  const costKrw = sum(facts, 'cost_krw');
  const marginKrw = sum(facts, 'margin_krw');
  const conversions = sum(facts, 'conversions');
  const clicks = sum(facts, 'clicks');

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    filters: { days, platform, product_id: productId, tenant_id: tenantId, limit },
    summary: {
      facts: facts.length,
      impressions: sum(facts, 'impressions'),
      clicks,
      cta_clicks: sum(facts, 'cta_clicks'),
      conversions,
      cost_krw: costKrw,
      revenue_krw: sum(facts, 'revenue_krw'),
      margin_krw: marginKrw,
      cpa_krw: conversions > 0 ? Math.round(costKrw / conversions) : null,
      margin_roas_pct: costKrw > 0 ? Math.round((marginKrw / costKrw) * 10000) / 100 : null,
      ctr_pct: sum(facts, 'impressions') > 0 ? Math.round((clicks / sum(facts, 'impressions')) * 10000) / 100 : null,
    },
    facts,
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
    },
  });
});
