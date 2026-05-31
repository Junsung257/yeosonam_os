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

export const POST = withAdminGuard(async () => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }

  const config = getNaverAdsConfigStatus();
  if (!config.configured) {
    return NextResponse.json({
      ok: false,
      error: 'Naver SearchAd API keys are not configured.',
      config,
      saved: false,
      next_action: 'Set NAVER_ADS_API_KEY, NAVER_ADS_SECRET_KEY, and NAVER_ADS_CUSTOMER_ID first.',
    }, { status: 400 });
  }

  const [campaignRes, adgroupRes, channelRes] = await Promise.all([
    fetchNaverCampaigns({ recordSize: 100 }),
    fetchNaverAdgroups({ recordSize: 100 }),
    fetchNaverBusinessChannels({ recordSize: 100 }),
  ]);

  const firstError = campaignRes.error || adgroupRes.error || channelRes.error;
  if (firstError) {
    return NextResponse.json({
      ok: false,
      error: firstError,
      saved: false,
      counts: {
        campaigns: campaignRes.campaigns.length,
        adgroups: adgroupRes.adgroups.length,
        channels: channelRes.channels.length,
      },
    }, { status: 502 });
  }

  const firstCampaign = campaignRes.campaigns[0] || null;
  const firstAdgroup = adgroupRes.adgroups[0] || null;
  const firstChannel = channelRes.channels[0] || null;

  const summary = {
    campaigns: campaignRes.campaigns.length,
    adgroups: adgroupRes.adgroups.length,
    channels: channelRes.channels.length,
    external_campaign_id: firstCampaign?.nccCampaignId || null,
    external_ad_group_id: firstAdgroup?.nccAdgroupId || null,
    external_account_id: firstChannel?.nccBusinessChannelId || null,
  };

  if (!firstAdgroup) {
    const nextAction = campaignRes.campaigns.length === 0
      ? 'Create a Naver SearchAd campaign first, then create a business channel and ad group.'
      : channelRes.channels.length === 0
        ? 'Register and approve a Naver business channel, then create an ad group.'
        : 'Create a Naver ad group under the campaign/business channel, then run sync again.';

    return NextResponse.json({
      ok: true,
      saved: false,
      summary,
      next_action: nextAction,
    });
  }

  const row = {
    tenant_id: null,
    platform: 'naver',
    external_campaign_id: firstAdgroup.nccCampaignId || firstCampaign?.nccCampaignId || null,
    external_ad_group_id: firstAdgroup.nccAdgroupId,
    external_account_id: firstChannel?.nccBusinessChannelId || null,
    external_config_note: `Synced from Naver assets: ${firstAdgroup.name || firstAdgroup.nccAdgroupId}`,
    updated_at: new Date().toISOString(),
  };

  const existing = await supabaseAdmin
    .from('ad_os_channel_budgets')
    .select('id, monthly_budget_krw, daily_budget_cap_krw, max_cpc_krw, max_test_loss_krw, automation_level, status')
    .is('tenant_id', null)
    .eq('platform', 'naver')
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json({ ok: false, error: existing.error.message, saved: false }, { status: 500 });
  }

  const query = existing.data?.id
    ? supabaseAdmin
        .from('ad_os_channel_budgets')
        .update(row)
        .eq('id', existing.data.id)
        .select('*')
        .single()
    : supabaseAdmin
        .from('ad_os_channel_budgets')
        .insert({
          ...row,
          monthly_budget_krw: 0,
          daily_budget_cap_krw: 0,
          max_cpc_krw: 0,
          max_test_loss_krw: 0,
          automation_level: 1,
          status: 'paused',
        })
        .select('*')
        .single();

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message, saved: false }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    saved: true,
    summary,
    saved_budget: data,
    next_action: 'Naver ad group ID was saved. Run launch audit, then run the paused keyword publisher dry-run.',
  });
});
