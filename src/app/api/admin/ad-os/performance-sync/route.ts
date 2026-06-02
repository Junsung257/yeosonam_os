import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type PerformanceSyncBody = {
  days?: number;
  apply?: boolean;
  limit?: number;
};

function todayMinus(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function dateOnly(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as PerformanceSyncBody;
  const days = Math.min(Math.max(Number(body.days || 14), 1), 90);
  const apply = body.apply !== false;
  const limit = Math.min(Math.max(Number(body.limit || 500), 1), 2000);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'performance_sync',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { days, apply, source: 'performance_sync_v1' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const since = todayMinus(days);
  const [mappingRes, campaignRes, engagementRes] = await Promise.all([
    supabaseAdmin
      .from('ad_landing_mappings')
      .select('id, platform, keyword, clicks, cta_clicks, conversions, conversion_value_krw, content_creative_id, campaign_id, scenario_id, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from('ad_campaigns')
      .select('id, package_id, channel, total_spend_krw, status, updated_at, created_at')
      .in('channel', ['naver', 'google', 'meta', 'kakao'])
      .order('updated_at', { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from('blog_engagement_logs')
      .select('content_creative_id, ad_landing_mapping_id, time_on_page_seconds, max_scroll_depth_pct, cta_clicked, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit),
  ]);

  const firstError = mappingRes.error || campaignRes.error || engagementRes.error;
  if (firstError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: firstError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const spendByCampaign = new Map(
    (campaignRes.data || []).map((row: any) => [row.id, {
      product_id: row.package_id || null,
      cost_krw: Number(row.total_spend_krw || 0),
      platform: row.channel || 'organic',
    }]),
  );

  const engagementByMapping = new Map<string, Array<any>>();
  const engagementByCreative = new Map<string, Array<any>>();
  for (const row of engagementRes.data || []) {
    if (row.ad_landing_mapping_id) {
      const list = engagementByMapping.get(row.ad_landing_mapping_id) || [];
      list.push(row);
      engagementByMapping.set(row.ad_landing_mapping_id, list);
    }
    if (row.content_creative_id) {
      const list = engagementByCreative.get(row.content_creative_id) || [];
      list.push(row);
      engagementByCreative.set(row.content_creative_id, list);
    }
  }

  const facts = (mappingRes.data || []).map((mapping: any) => {
    const campaignSpend = mapping.campaign_id ? spendByCampaign.get(mapping.campaign_id) : null;
    const engagement = [
      ...(mapping.id ? engagementByMapping.get(mapping.id) || [] : []),
      ...(mapping.content_creative_id ? engagementByCreative.get(mapping.content_creative_id) || [] : []),
    ];
    const sessions = engagement.length;
    const bounces = engagement.filter((row) =>
      !row.cta_clicked &&
      Number(row.time_on_page_seconds || 0) < 15 &&
      Number(row.max_scroll_depth_pct || 0) < 35,
    ).length;
    const avgTime = sessions > 0
      ? Math.round(engagement.reduce((sum, row) => sum + Number(row.time_on_page_seconds || 0), 0) / sessions)
      : 0;
    const avgScroll = sessions > 0
      ? Math.round((engagement.reduce((sum, row) => sum + Number(row.max_scroll_depth_pct || 0), 0) / sessions) * 10) / 10
      : 0;

    return {
      product_id: campaignSpend?.product_id || null,
      scenario_id: mapping.scenario_id || null,
      ad_landing_mapping_id: mapping.id,
      content_creative_id: mapping.content_creative_id || null,
      ad_campaign_id: mapping.campaign_id || null,
      platform: mapping.platform || campaignSpend?.platform || 'organic',
      keyword_text: mapping.keyword || null,
      source: 'ad_landing_mappings',
      event_date: dateOnly(mapping.updated_at),
      impressions: 0,
      clicks: Number(mapping.clicks || 0),
      cost_krw: Number(campaignSpend?.cost_krw || 0),
      cta_clicks: Number(mapping.cta_clicks || 0),
      conversions: Number(mapping.conversions || 0),
      revenue_krw: Number(mapping.conversion_value_krw || 0),
      margin_krw: 0,
      bounces,
      sessions,
      avg_time_on_page_seconds: avgTime,
      avg_scroll_depth_pct: avgScroll,
      metrics: {
        run_id: run.id,
        source_updated_at: mapping.updated_at,
        campaign_spend_found: Boolean(campaignSpend),
      },
      updated_at: new Date().toISOString(),
    };
  });

  if (apply && facts.length > 0) {
    const { error } = await supabaseAdmin.from('ad_os_performance_facts').insert(facts);
    if (error) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  const summary = {
    days,
    apply,
    facts_prepared: facts.length,
    mappings_checked: mappingRes.data?.length || 0,
    campaigns_checked: campaignRes.data?.length || 0,
    engagement_logs_checked: engagementRes.data?.length || 0,
    total_clicks: facts.reduce((sum, row) => sum + row.clicks, 0),
    total_cta_clicks: facts.reduce((sum, row) => sum + row.cta_clicks, 0),
    total_conversions: facts.reduce((sum, row) => sum + row.conversions, 0),
    total_revenue_krw: facts.reduce((sum, row) => sum + row.revenue_krw, 0),
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, sample: facts.slice(0, 20) });
});
