import { NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import {
  fetchNaverAdgroups,
  fetchNaverBusinessChannels,
  fetchNaverCampaigns,
  getNaverAdsConfigStatus,
} from '@/lib/search-ads-api';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type KeywordPlan = {
  campaign_name: string | null;
  ad_group_name: string | null;
  keyword_text: string | null;
  match_type: string | null;
  suggested_bid_krw: number | null;
  landing_url: string | null;
  utm_url: string | null;
};

function compactName(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value || '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
  return (cleaned || fallback).slice(0, 60);
}

function buildCsv(rows: KeywordPlan[]): string {
  const header = ['keyword', 'match_type', 'bid_krw', 'landing_url'].join(',');
  const lines = rows.map((row) =>
    [
      row.keyword_text || '',
      row.match_type || '',
      String(Math.max(70, Math.round(Number(row.suggested_bid_krw || 70)))),
      row.utm_url || row.landing_url || '',
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

export const POST = withAdminGuard(async () => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }

  const config = getNaverAdsConfigStatus();
  const [budgetRes, keywordRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('monthly_budget_krw,daily_budget_cap_krw,max_cpc_krw,external_ad_group_id')
      .is('tenant_id', null)
      .eq('platform', 'naver')
      .maybeSingle(),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('campaign_name,ad_group_name,keyword_text,match_type,suggested_bid_krw,landing_url,utm_url')
      .eq('platform', 'naver')
      .in('autopilot_status', ['approved', 'testing'])
      .is('external_keyword_id', null)
      .order('opportunity_score', { ascending: false })
      .limit(30),
  ]);

  const firstError = budgetRes.error || keywordRes.error;
  if (firstError) {
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const keywords = (keywordRes.data || []) as KeywordPlan[];
  const firstKeyword = keywords[0] || null;
  const budget = budgetRes.data;

  const [campaignRes, adgroupRes, channelRes] = config.configured
    ? await Promise.all([
        fetchNaverCampaigns({ recordSize: 100 }),
        fetchNaverAdgroups({ recordSize: 100 }),
        fetchNaverBusinessChannels({ recordSize: 100 }),
      ])
    : [
        { ok: false, campaigns: [], error: 'Naver API not configured.' },
        { ok: false, adgroups: [], error: 'Naver API not configured.' },
        { ok: false, channels: [], error: 'Naver API not configured.' },
      ];

  const campaignName = compactName(firstKeyword?.campaign_name, 'YSN_Search_Pilot_Naver');
  const adGroupName = compactName(firstKeyword?.ad_group_name, `${campaignName}_longtail`);
  const maxCpcKrw = Math.max(70, Number(budget?.max_cpc_krw || 500));
  const dailyBudgetKrw = Math.max(1000, Number(budget?.daily_budget_cap_krw || 10000));
  const monthlyBudgetKrw = Math.max(dailyBudgetKrw, Number(budget?.monthly_budget_krw || 100000));

  const requiredExternal = [
    {
      item: 'SearchAd campaign',
      status: campaignRes.campaigns.length > 0 ? 'exists' : 'missing',
      suggested_value: campaignRes.campaigns[0]?.name || campaignName,
    },
    {
      item: 'Business channel',
      status: channelRes.channels.length > 0 ? 'exists' : 'missing',
      suggested_value: channelRes.channels[0]?.url || firstKeyword?.landing_url || 'https://www.yeosonam.com',
    },
    {
      item: 'Ad group',
      status: adgroupRes.adgroups.length > 0 || budget?.external_ad_group_id ? 'exists' : 'missing',
      suggested_value: adgroupRes.adgroups[0]?.name || adGroupName,
    },
  ];

  const packet = {
    campaign_name: campaignName,
    ad_group_name: adGroupName,
    daily_budget_krw: dailyBudgetKrw,
    monthly_budget_krw: monthlyBudgetKrw,
    max_cpc_krw: maxCpcKrw,
    landing_url: firstKeyword?.landing_url || null,
    final_url: firstKeyword?.utm_url || firstKeyword?.landing_url || null,
    keyword_count: keywords.length,
    keyword_samples: keywords.slice(0, 12).map((row) => ({
      keyword: row.keyword_text,
      match_type: row.match_type,
      bid_krw: Math.min(maxCpcKrw, Math.max(70, Math.round(Number(row.suggested_bid_krw || 70)))),
      final_url: row.utm_url || row.landing_url,
    })),
    keyword_csv: buildCsv(keywords.slice(0, 30)),
  };

  const nextAction = requiredExternal.find((row) => row.status === 'missing')?.item
    ? 'Create the missing Naver campaign/business channel/ad group using this packet, then run Naver asset auto-save.'
    : 'Naver assets exist. Run Naver asset auto-save, then run launch audit.';

  return NextResponse.json({
    ok: true,
    config,
    existing_assets: {
      campaigns: campaignRes.campaigns.length,
      adgroups: adgroupRes.adgroups.length,
      channels: channelRes.channels.length,
      stored_adgroup_id: budget?.external_ad_group_id || null,
    },
    required_external: requiredExternal,
    packet,
    next_action: nextAction,
  });
});
