import { NextRequest, NextResponse } from 'next/server';
import { buildNaverExternalAssetPlan } from '@/lib/ad-os-v19-v25';
import { withAdminGuard } from '@/lib/admin-guard';
import {
  fetchNaverAdgroups,
  fetchNaverBusinessChannels,
  fetchNaverCampaigns,
  getNaverAdsConfigStatus,
} from '@/lib/search-ads-api';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function slugPart(value: unknown): string {
  return String(value || 'package')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'package';
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured.' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const mode = apply ? 'change_request' : 'dry_run';

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'external_asset_plan',
      mode,
      status: 'running',
      summary: { platform: 'naver', apply, external_spend_krw: 0 },
    })
    .select('id')
    .single();
  if (runError) return NextResponse.json({ ok: false, error: runError.message }, { status: 500 });

  const [budgetRes, tenantPolicyRes, keywordRes, packageRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('*')
      .eq('platform', 'naver')
      .maybeSingle(),
    supabaseAdmin
      .from('ad_os_tenant_governance')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('id')
      .eq('platform', 'naver')
      .in('autopilot_status', ['approved', 'testing'])
      .limit(500),
    supabaseAdmin
      .from('travel_packages')
      .select('id,title,destination')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const config = getNaverAdsConfigStatus();
  const [campaignRes, adgroupRes, channelRes] = config.configured
    ? await Promise.all([
        fetchNaverCampaigns({ recordSize: 100 }),
        fetchNaverAdgroups({ recordSize: 100 }),
        fetchNaverBusinessChannels({ recordSize: 100 }),
      ])
    : [
        { ok: false, campaigns: [], error: 'Naver API is not configured.' },
        { ok: false, adgroups: [], error: 'Naver API is not configured.' },
        { ok: false, channels: [], error: 'Naver API is not configured.' },
      ];

  const budget = budgetRes.data as {
    monthly_budget_krw?: number | null;
    daily_budget_cap_krw?: number | null;
    max_cpc_krw?: number | null;
    external_ad_group_id?: string | null;
    status?: string | null;
  } | null;
  const tenantPolicy = tenantPolicyRes.data as {
    allowed_platforms?: string[] | null;
    risk_status?: string | null;
  } | null;
  const pkg = packageRes.data as { id?: string; title?: string | null; destination?: string | null } | null;
  const baseName = slugPart(pkg?.destination || pkg?.title || 'travel');
  const plan = buildNaverExternalAssetPlan({
    campaignName: `YSN_${baseName}_${String(pkg?.id || 'ad_os').slice(0, 8)}`,
    adGroupName: `YSN_${baseName}_longtail`,
    landingUrl: pkg?.id ? `/packages/${pkg.id}` : null,
    dailyBudgetKrw: Number(budget?.daily_budget_cap_krw || 0),
    monthlyBudgetKrw: Number(budget?.monthly_budget_krw || 0),
    maxCpcKrw: Number(budget?.max_cpc_krw || 0),
    approvedKeywordCount: keywordRes.data?.length || 0,
    existingCampaigns: campaignRes.campaigns.length,
    existingAdgroups: adgroupRes.adgroups.length,
    existingChannels: channelRes.channels.length,
    storedAdgroupId: budget?.external_ad_group_id || null,
    integrationReady: config.configured,
    tenantAllowed: !tenantPolicy || (tenantPolicy.allowed_platforms || ['naver']).includes('naver'),
    killSwitchActive: budget?.status === 'paused' && tenantPolicy?.risk_status === 'blocked',
  });

  let insertedChangeRequests = 0;
  let insertedMutationRows = 0;
  if (apply && plan.mutations.length > 0) {
    const changeRows = plan.mutations.map((mutation, index) => ({
      run_id: run.id,
      platform: 'naver',
      automation_level: 2,
      request_type: mutation.requestType,
      target_table: 'naver_searchad_assets',
      target_id: `${mutation.mutationType}:${index}`,
      status: 'proposed',
      title: mutation.title,
      reason: plan.canRequest
        ? 'V19 publisher requires human approval before creating or syncing Naver external assets.'
        : `Blocked by ${plan.blockers.join(', ')}`,
      risk_level: mutation.requestType === 'publish_paused_keyword' ? 'high' : 'medium',
      expected_impact: {
        external_spend_krw: 0,
        mutation_type: mutation.mutationType,
      },
      proposed_change: mutation.proposedChange,
      rollback_payload: {
        platform: 'naver',
        action: 'pause_or_remove_created_asset',
      },
      approval_required: true,
      expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
    }));

    const { data: requestData, error: requestError } = await supabaseAdmin
      .from('ad_os_change_requests')
      .insert(changeRows)
      .select('id, target_id');
    if (requestError) return NextResponse.json({ ok: false, error: requestError.message }, { status: 500 });
    insertedChangeRequests = requestData?.length || 0;

    const mutationRows = plan.mutations.map((mutation, index) => ({
      platform: 'naver',
      mutation_type: mutation.mutationType,
      mode,
      status: plan.canRequest ? 'requested' : 'blocked',
      change_request_id: requestData?.[index]?.id || null,
      run_id: run.id,
      external_ad_group_id: budget?.external_ad_group_id || null,
      idempotency_key: `naver:${mutation.mutationType}:${run.id}:${index}`,
      request_payload: mutation.proposedChange,
      response_payload: {
        external_spend_krw: 0,
        approval_required: true,
      },
      error_message: plan.canRequest ? null : plan.blockers.join(', '),
    }));
    const { data: mutationData, error: mutationError } = await supabaseAdmin
      .from('ad_os_external_mutation_results')
      .insert(mutationRows)
      .select('id');
    if (mutationError) return NextResponse.json({ ok: false, error: mutationError.message }, { status: 500 });
    insertedMutationRows = mutationData?.length || 0;
  }

  await supabaseAdmin.from('ad_os_automation_runs').update({
    status: 'completed',
    finished_at: new Date().toISOString(),
    summary: {
      platform: 'naver',
      apply,
      can_request: plan.canRequest,
      blockers: plan.blockers,
      mutations: plan.mutations.length,
      inserted_change_requests: insertedChangeRequests,
      inserted_mutation_rows: insertedMutationRows,
      external_spend_krw: 0,
    },
  }).eq('id', run.id);

  return NextResponse.json({
    ok: true,
    apply,
    run_id: run.id,
    config,
    existing_assets: {
      campaigns: campaignRes.campaigns.length,
      adgroups: adgroupRes.adgroups.length,
      channels: channelRes.channels.length,
      stored_adgroup_id: budget?.external_ad_group_id || null,
    },
    plan,
    summary: {
      can_request: plan.canRequest,
      blockers: plan.blockers,
      mutations: plan.mutations.length,
      inserted_change_requests: insertedChangeRequests,
      inserted_mutation_rows: insertedMutationRows,
      external_spend_krw: 0,
    },
  });
});
