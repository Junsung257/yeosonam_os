import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const SEARCH_PLATFORMS = ['naver', 'google'] as const;

type Platform = typeof SEARCH_PLATFORMS[number];

type KeywordPlanRow = {
  id: string;
  package_id: string;
  platform: Platform;
  campaign_name: string;
  ad_group_name: string;
  keyword_text: string;
  tier: string;
  match_type: string;
  suggested_bid_krw: number | null;
  landing_url: string;
  utm_url: string;
  ad_campaign_id: string | null;
  travel_packages?: {
    title?: string | null;
    destination?: string | null;
    price?: number | null;
  } | null;
};

function hasAllSecrets(names: string[]): boolean {
  return names.every((name) => Boolean(getSecret(name as never)));
}

function integrationReady(platform: Platform): boolean {
  if (platform === 'naver') return hasAllSecrets(['NAVER_ADS_API_KEY', 'NAVER_ADS_SECRET_KEY', 'NAVER_ADS_CUSTOMER_ID']);
  return hasAllSecrets(['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET']);
}

function jsonState(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value));
}

function groupKey(row: KeywordPlanRow): string {
  return `${row.package_id}:${row.platform}:${row.campaign_name}`;
}

function buildHeadline(row: KeywordPlanRow): string {
  const destination = row.travel_packages?.destination || row.keyword_text.split(' ')[0] || '여행';
  return `${destination} 맞춤 패키지`.slice(0, 40);
}

function buildDescription(rows: KeywordPlanRow[]): string {
  const first = rows[0];
  const price = first.travel_packages?.price ? `${Number(first.travel_packages.price).toLocaleString('ko-KR')}원` : '상담 문의';
  return `${first.travel_packages?.title || first.keyword_text} ${price} 여소남에서 확인하세요`.slice(0, 120);
}

async function upsertPilotBudget(platform: Platform, monthlyBudgetKrw: number, dailyBudgetKrw: number, maxCpcKrw: number) {
  const row = {
    tenant_id: null,
    platform,
    monthly_budget_krw: monthlyBudgetKrw,
    daily_budget_cap_krw: dailyBudgetKrw,
    max_cpc_krw: maxCpcKrw,
    max_test_loss_krw: Math.min(dailyBudgetKrw, 10000),
    automation_level: 1,
    status: 'active',
    notes: 'Ad OS L1 pilot preset. External publishing remains separately guarded.',
    updated_at: new Date().toISOString(),
  };

  const existing = await supabaseAdmin
    .from('ad_os_channel_budgets')
    .select('id')
    .is('tenant_id', null)
    .eq('platform', platform)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  if (existing.data?.id) {
    const { error } = await supabaseAdmin.from('ad_os_channel_budgets').update(row).eq('id', existing.data.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabaseAdmin.from('ad_os_channel_budgets').insert(row);
  if (error) throw new Error(error.message);
}

async function approveNaverCandidates(runId: string, maxCpcKrw: number, limit: number, apply: boolean) {
  const { data, error } = await supabaseAdmin
    .from('search_ad_keyword_plans')
    .select('id,keyword_text,plan_status,autopilot_status,suggested_bid_krw,max_cpc_krw')
    .eq('platform', 'naver')
    .eq('plan_status', 'draft')
    .eq('autopilot_status', 'candidate')
    .neq('tier', 'negative')
    .is('external_keyword_id', null)
    .order('opportunity_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit * 4);
  if (error) throw new Error(error.message);

  const rows = (data || []) as Array<{
    id: string;
    keyword_text: string;
    plan_status: string | null;
    autopilot_status: string | null;
    suggested_bid_krw: number | null;
    max_cpc_krw?: number | null;
  }>;
  const eligibleRows = rows
    .filter((row) => Number(row.suggested_bid_krw || row.max_cpc_krw || 0) <= maxCpcKrw)
    .slice(0, limit);
  const eligibleIds = new Set(eligibleRows.map((row) => row.id));

  const decisions = rows.slice(0, Math.max(limit, eligibleRows.length)).map((row) => {
    const bid = Number(row.suggested_bid_krw || row.max_cpc_krw || 0);
    const eligible = eligibleIds.has(row.id);
    return {
      run_id: runId,
      platform: 'naver',
      decision_type: eligible ? 'approve' : 'no_change',
      target_table: 'search_ad_keyword_plans',
      target_id: row.id,
      before_state: jsonState({ plan_status: row.plan_status, autopilot_status: row.autopilot_status, suggested_bid_krw: bid }),
      after_state: jsonState({ plan_status: eligible ? 'approved' : row.plan_status, autopilot_status: eligible ? 'approved' : row.autopilot_status }),
      reason: eligible ? 'Approved by L1 pilot setup because bid is within Max CPC.' : 'Held by L1 pilot setup guardrail.',
      confidence: eligible ? 0.8 : 0.58,
      expected_impact: jsonState({ external_spend_krw: 0, suggested_bid_krw: bid, max_cpc_krw: maxCpcKrw }),
      applied: false,
      blocked_reason: eligible ? null : 'guardrail',
    };
  });

  if (decisions.length > 0) {
    const { error: decisionError } = await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);
    if (decisionError) throw new Error(decisionError.message);
  }

  if (apply && eligibleRows.length > 0) {
    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from('search_ad_keyword_plans')
      .update({
        plan_status: 'approved',
        autopilot_status: 'approved',
        automation_level: 1,
        last_decision_at: now,
        decision_reason: 'Approved by Ad OS L1 pilot setup.',
        updated_at: now,
      })
      .in('id', eligibleRows.map((row) => row.id));
    if (updateError) throw new Error(updateError.message);

    await supabaseAdmin.from('ad_os_decision_logs').update({ applied: true }).eq('run_id', runId).eq('decision_type', 'approve');
  }

  return {
    checked: rows.length,
    eligible: eligibleRows.length,
    approved: apply ? eligibleRows.length : 0,
  };
}

async function createInternalDrafts(runId: string, maxCpcKrw: number, dailyBudgetKrw: number, limit: number, apply: boolean) {
  const { data, error } = await supabaseAdmin
    .from('search_ad_keyword_plans')
    .select(`
      id, package_id, platform, campaign_name, ad_group_name, keyword_text, tier, match_type,
      suggested_bid_krw, landing_url, utm_url, ad_campaign_id,
      travel_packages:package_id(title,destination,price)
    `)
    .in('platform', SEARCH_PLATFORMS)
    .eq('plan_status', 'approved')
    .in('autopilot_status', ['approved', 'testing'])
    .neq('tier', 'negative')
    .is('ad_campaign_id', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data || []) as unknown as KeywordPlanRow[];
  const groups = new Map<string, KeywordPlanRow[]>();
  for (const row of rows) {
    const list = groups.get(groupKey(row)) || [];
    list.push(row);
    groups.set(groupKey(row), list);
  }

  let createdCampaigns = 0;
  let createdCreatives = 0;
  let linkedKeywords = 0;
  const decisions: Array<Record<string, unknown>> = [];

  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    const maxBid = Math.max(...groupRows.map((row) => Number(row.suggested_bid_krw || 0)));
    const eligible = integrationReady(first.platform) && maxBid <= maxCpcKrw;
    decisions.push({
      run_id: runId,
      platform: first.platform,
      decision_type: eligible ? 'start_test' : 'no_change',
      target_table: 'search_ad_keyword_plans',
      target_id: first.id,
      before_state: jsonState({ keyword_count: groupRows.length, campaign_name: first.campaign_name }),
      after_state: jsonState({ internal_draft: eligible ? 'ready' : 'blocked' }),
      reason: eligible ? 'L1 pilot setup can create an internal campaign draft. External publishing remains blocked.' : 'L1 pilot setup held this group by integration or Max CPC guardrail.',
      confidence: eligible ? 0.78 : 0.58,
      expected_impact: jsonState({ external_spend_krw: 0, keyword_count: groupRows.length, max_bid_krw: maxBid }),
      applied: false,
      blocked_reason: eligible ? null : 'guardrail',
    });

    if (!apply || !eligible) continue;

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('ad_campaigns')
      .insert({
        package_id: first.package_id,
        name: `[${first.platform.toUpperCase()} L1] ${first.campaign_name}`,
        channel: first.platform,
        status: 'DRAFT',
        objective: 'CONVERSIONS',
        daily_budget_krw: dailyBudgetKrw,
        total_spend_krw: 0,
        created_by: 'ad_os_l1_pilot',
      })
      .select('id')
      .single();
    if (campaignError || !campaign) throw new Error(campaignError?.message || 'campaign insert failed');

    const headline = buildHeadline(first);
    const description = buildDescription(groupRows);
    const { data: creative, error: creativeError } = await supabaseAdmin
      .from('ad_creatives')
      .insert({
        product_id: first.package_id,
        campaign_id: campaign.id,
        creative_type: 'text_ad',
        channel: first.platform,
        variant_index: 1,
        hook_type: first.tier === 'longtail' ? 'departure' : 'destination',
        tone: 'informative',
        key_selling_point: first.keyword_text,
        target_segment: 'middle_age',
        headline,
        primary_text: description,
        description,
        body: description,
        keywords: groupRows.map((row) => row.keyword_text),
        ad_copies: {
          headlines: Array.from(new Set([headline, ...groupRows.map((row) => row.keyword_text)])).slice(0, 15),
          descriptions: [description],
          final_url: first.utm_url,
          ad_group_name: first.ad_group_name,
          match_types: groupRows.map((row) => ({ keyword: row.keyword_text, match_type: row.match_type })),
        },
        utm_params: { final_url: first.utm_url, landing_url: first.landing_url, source: first.platform, medium: 'cpc' },
        status: 'review',
      })
      .select('id')
      .single();
    if (creativeError || !creative) throw new Error(creativeError?.message || 'creative insert failed');

    const keywordIds = groupRows.map((row) => row.id);
    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from('search_ad_keyword_plans')
      .update({
        ad_campaign_id: campaign.id,
        ad_creative_id: creative.id,
        draft_published_at: now,
        autopilot_status: 'testing',
        last_decision_at: now,
        decision_reason: 'Internal campaign draft created by Ad OS L1 pilot setup.',
        updated_at: now,
      })
      .in('id', keywordIds);
    if (updateError) throw new Error(updateError.message);

    createdCampaigns += 1;
    createdCreatives += 1;
    linkedKeywords += keywordIds.length;
  }

  if (decisions.length > 0) {
    const { error: decisionError } = await supabaseAdmin.from('ad_os_decision_logs').insert(decisions.map((decision) => ({
      ...decision,
      applied: apply && decision.decision_type === 'start_test',
    })));
    if (decisionError) throw new Error(decisionError.message);
  }

  return {
    checked_keywords: rows.length,
    checked_groups: groups.size,
    eligible_groups: decisions.filter((decision) => decision.decision_type === 'start_test').length,
    created_campaigns: createdCampaigns,
    created_creatives: createdCreatives,
    linked_keywords: linkedKeywords,
  };
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const monthlyBudgetKrw = Math.min(Math.max(Number(body.monthlyBudgetKrw || 100000), 10000), 1000000);
  const dailyBudgetKrw = Math.min(Math.max(Number(body.dailyBudgetKrw || 10000), 1000), monthlyBudgetKrw);
  const maxCpcKrw = Math.min(Math.max(Number(body.maxCpcKrw || 500), 50), 5000);
  const keywordLimit = Math.min(Math.max(Number(body.keywordLimit || 20), 1), 100);
  const draftLimit = Math.min(Math.max(Number(body.draftLimit || 80), 1), 200);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'full_autopilot',
      mode,
      platform: null,
      status: 'running',
      summary: { apply, monthlyBudgetKrw, dailyBudgetKrw, maxCpcKrw, level: 'L1_pilot_setup' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'Failed to create pilot setup run' }, { status: 500 });
  }

  try {
    if (apply) {
      await Promise.all(SEARCH_PLATFORMS.map((platform) => upsertPilotBudget(platform, monthlyBudgetKrw, dailyBudgetKrw, maxCpcKrw)));
    }

    const naverApproval = await approveNaverCandidates(run.id, maxCpcKrw, keywordLimit, apply);
    const internalDrafts = await createInternalDrafts(run.id, maxCpcKrw, dailyBudgetKrw, draftLimit, apply);

    const summary = {
      budget_channels_configured: apply ? SEARCH_PLATFORMS.length : 0,
      monthly_budget_krw: monthlyBudgetKrw,
      daily_budget_krw: dailyBudgetKrw,
      max_cpc_krw: maxCpcKrw,
      naver_keywords_checked: naverApproval.checked,
      naver_keywords_eligible: naverApproval.eligible,
      naver_keywords_approved: naverApproval.approved,
      internal_draft_groups_checked: internalDrafts.checked_groups,
      internal_draft_groups_eligible: internalDrafts.eligible_groups,
      internal_campaigns_created: internalDrafts.created_campaigns,
      internal_creatives_created: internalDrafts.created_creatives,
      linked_keywords: internalDrafts.linked_keywords,
      external_spend_krw: 0,
      applied: apply,
    };

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
      .eq('id', run.id);

    return NextResponse.json({
      ok: true,
      run_id: run.id,
      summary,
      next_action: '네이버 외부 광고그룹 ID와 Google 권한이 통과되면 외부 publisher를 guarded 모드로 열 수 있습니다.',
    });
  } catch (error) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        errors: [{ message: error instanceof Error ? error.message : String(error) }],
      })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Pilot setup failed' }, { status: 500 });
  }
});
