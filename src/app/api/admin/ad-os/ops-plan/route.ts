import { NextRequest, NextResponse } from 'next/server';
import {
  buildBudgetOpsDecision,
  buildCreativeFactoryDrafts,
  buildPublisherOpsPlan,
  buildTenantSaasPackaging,
  decideDuplicateContentAction,
  mineLongtailKeywords,
  normalizeFunnelEvent,
} from '@/lib/ad-os-v13-v18';
import { riskForChangeRequest, titleForChangeRequest, type AdOsChangeRequestType } from '@/lib/ad-os-change-request';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type PackageRow = {
  id: string;
  title: string | null;
  destination: string | null;
  price: number | null;
  departure_airport?: string | null;
  airline?: string | null;
  tenant_id?: string | null;
};

type KeywordRow = {
  id: string;
  platform: 'naver' | 'google';
  keyword_text: string;
  plan_status: string;
  autopilot_status?: string | null;
};

type BudgetRow = {
  id: string;
  platform: string;
  status: string;
  monthly_budget_krw: number;
  daily_budget_cap_krw: number;
  max_cpc_krw: number;
  max_test_loss_krw?: number | null;
  automation_level: number;
};

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function changeRequestRow(input: {
  tenantId?: string | null;
  platform?: string | null;
  automationLevel?: number;
  requestType: AdOsChangeRequestType;
  targetTable: string;
  targetId: string;
  reason: string;
  proposedChange: Record<string, unknown>;
  rollbackPayload: Record<string, unknown>;
  expectedImpact?: Record<string, unknown>;
}) {
  const automationLevel = Math.max(0, Math.min(5, Math.round(Number(input.automationLevel ?? 2))));
  const riskLevel = riskForChangeRequest({
    requestType: input.requestType,
    automationLevel,
    changesExternalAccount: ['publish_paused_keyword', 'activate_paused_keyword', 'upload_conversion_signal'].includes(input.requestType),
  });
  return {
    tenant_id: input.tenantId ?? null,
    platform: input.platform ?? null,
    automation_level: automationLevel,
    request_type: input.requestType,
    target_table: input.targetTable,
    target_id: input.targetId,
    status: 'proposed',
    title: titleForChangeRequest(input.requestType),
    reason: input.reason,
    risk_level: riskLevel,
    expected_impact: json(input.expectedImpact || {}),
    proposed_change: json(input.proposedChange),
    rollback_payload: json(input.rollbackPayload),
    approval_required: true,
    expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = asBool(body.apply);
  const packageId = typeof body.package_id === 'string' ? body.package_id : null;
  const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id : null;

  const packageQuery = supabaseAdmin
    .from('travel_packages')
    .select('id,title,destination,price,departure_airport,airline,tenant_id')
    .order('created_at', { ascending: false })
    .limit(1);
  const packageRes = packageId ? await packageQuery.eq('id', packageId).maybeSingle() : await packageQuery.maybeSingle();
  const workspaceQuery = supabaseAdmin.from('tenant_ad_workspaces').select('*');
  const scopedWorkspaceQuery = tenantId ? workspaceQuery.eq('tenant_id', tenantId) : workspaceQuery.is('tenant_id', null);
  const naverAccountQuery = supabaseAdmin
    .from('ad_os_tenant_ad_accounts')
    .select('platform,connection_status,external_campaign_id,external_ad_group_id,can_publish_keywords,risk_status');
  const scopedNaverAccountQuery = tenantId ? naverAccountQuery.eq('tenant_id', tenantId) : naverAccountQuery.is('tenant_id', null);
  const googleAccountQuery = supabaseAdmin
    .from('ad_os_tenant_ad_accounts')
    .select('platform,connection_status,external_campaign_id,external_ad_group_id,can_publish_keywords,risk_status');
  const scopedGoogleAccountQuery = tenantId ? googleAccountQuery.eq('tenant_id', tenantId) : googleAccountQuery.is('tenant_id', null);

  const [keywordRes, budgetRes, workspaceRes, naverAccountRes, googleAccountRes, searchTermRes, conversionRes, scenarioRes] = await Promise.all([
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('id,platform,keyword_text,plan_status,autopilot_status')
      .in('platform', ['naver', 'google'])
      .limit(300),
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('id,platform,status,monthly_budget_krw,daily_budget_cap_krw,max_cpc_krw,max_test_loss_krw,automation_level')
      .in('platform', ['naver', 'google']),
    scopedWorkspaceQuery.maybeSingle(),
    scopedNaverAccountQuery.eq('platform', 'naver').maybeSingle(),
    scopedGoogleAccountQuery.eq('platform', 'google').maybeSingle(),
    supabaseAdmin
      .from('ad_os_search_terms')
      .select('search_term,action,status,score')
      .order('score', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('ad_os_conversion_events')
      .select('event_type,platform,revenue_krw,margin_krw,cost_krw,quarantine_status')
      .eq('quarantine_status', 'clean')
      .limit(500),
    supabaseAdmin
      .from('ad_os_product_scenarios')
      .select('id,scenario_type,primary_keyword,package_id,status')
      .limit(300),
  ]);

  const firstError =
    packageRes.error ||
    keywordRes.error ||
    budgetRes.error ||
    workspaceRes.error ||
    naverAccountRes.error ||
    googleAccountRes.error ||
    searchTermRes.error ||
    conversionRes.error ||
    scenarioRes.error;
  if (firstError) return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });

  const pkg = packageRes.data as PackageRow | null;
  const keywords = (keywordRes.data || []) as KeywordRow[];
  const budgets = (budgetRes.data || []) as BudgetRow[];
  const workspace = (workspaceRes.data || null) as Record<string, unknown> | null;
  const naverAccount = (naverAccountRes.data || null) as Record<string, unknown> | null;
  const googleAccount = (googleAccountRes.data || null) as Record<string, unknown> | null;
  const searchTerms = (searchTermRes.data || []) as Array<{ search_term: string; action: string; status: string; score: number }>;
  const conversions = (conversionRes.data || []) as Array<{ event_type: string; revenue_krw: number; margin_krw: number; cost_krw: number }>;
  const scenarios = (scenarioRes.data || []) as Array<{ package_id: string | null; scenario_type: string; primary_keyword: string; status: string }>;

  const approvedKeywords = keywords.filter((row) => ['approved', 'testing', 'active'].includes(row.autopilot_status || row.plan_status)).length;
  const budgetByPlatform = new Map(budgets.map((row) => [row.platform, row]));
  const naverBudget = budgetByPlatform.get('naver');
  const googleBudget = budgetByPlatform.get('google');
  const allowedPlatforms = new Set(((workspace?.allowed_platforms as string[] | undefined) || ['naver', 'google']).map(String));
  const killSwitch = workspace?.risk_status === 'blocked';

  const publisher = {
    naver: buildPublisherOpsPlan({
      platform: 'naver',
      credentialsReady: Boolean(naverAccount),
      permissionReady: ['credentials_ready', 'ready', 'no_campaign'].includes(String(naverAccount?.connection_status || '')),
      campaignReady: Boolean(naverAccount?.external_campaign_id),
      adGroupReady: Boolean(naverAccount?.external_ad_group_id),
      budgetReady: Boolean(naverBudget && naverBudget.status === 'active' && naverBudget.monthly_budget_krw > 0 && naverBudget.daily_budget_cap_krw > 0),
      approvedKeywords,
      tenantAllowed: allowedPlatforms.has('naver'),
      killSwitchActive: killSwitch,
    }),
    google: buildPublisherOpsPlan({
      platform: 'google',
      credentialsReady: Boolean(googleAccount),
      permissionReady: ['credentials_ready', 'ready', 'no_campaign'].includes(String(googleAccount?.connection_status || '')),
      campaignReady: Boolean(googleAccount?.external_campaign_id),
      budgetReady: Boolean(googleBudget && googleBudget.status === 'active' && googleBudget.monthly_budget_krw > 0 && googleBudget.daily_budget_cap_krw > 0),
      approvedKeywords,
      tenantAllowed: allowedPlatforms.has('google'),
      conversionActionReady: Boolean(googleAccount?.conversion_action_id || workspace?.google_conversion_action_ready),
      finalUrlPolicyReady: Boolean(workspace?.google_final_url_policy_ready),
      killSwitchActive: killSwitch,
    }),
  };

  const winningTerms = searchTerms.filter((row) => row.action === 'add_keyword').map((row) => row.search_term);
  const wasteTerms = searchTerms.filter((row) => row.action === 'add_negative').map((row) => row.search_term);
  const minedKeywords = pkg
    ? mineLongtailKeywords({
        product: {
          productId: pkg.id,
          title: pkg.title,
          destination: pkg.destination,
          departureAirport: pkg.departure_airport,
          airline: pkg.airline,
          priceKrw: pkg.price,
        },
        winningSearchTerms: winningTerms,
        wasteSearchTerms: wasteTerms,
        existingKeywords: keywords.map((row) => row.keyword_text),
        limit: 30,
      })
    : [];

  const sameDestinationProducts = scenarios.filter((row) => pkg && row.package_id !== pkg.id && row.primary_keyword.includes(pkg.destination || '')).length;
  const duplicateAction = decideDuplicateContentAction({
    sameDestinationActiveProducts: sameDestinationProducts,
    sameScenarioExistingPosts: scenarios.filter((row) => pkg && row.package_id === pkg.id).length,
    scenarioIsDistinct: minedKeywords.length > 0,
  });

  const spend = conversions.reduce((sum, row) => sum + Number(row.cost_krw || 0), 0);
  const revenue = conversions.reduce((sum, row) => sum + Number(row.revenue_krw || 0), 0);
  const margin = conversions.reduce((sum, row) => sum + Number(row.margin_krw || 0), 0);
  const sampleFunnel = normalizeFunnelEvent({
    eventType: 'booking',
    platform: 'naver',
    revenueKrw: revenue,
    marginKrw: margin,
    costKrw: spend,
  });

  const pacing = budgets.map((budget) =>
    buildBudgetOpsDecision({
      platform: budget.platform,
      monthlyBudgetKrw: budget.monthly_budget_krw,
      dailyBudgetCapKrw: budget.daily_budget_cap_krw,
      actualSpendKrw: spend,
      automationLevel: budget.automation_level,
      status: budget.status,
      killSwitchActive: killSwitch,
      marginRoasPct: sampleFunnel.margin_roas_pct,
      targetMarginRoasPct: 120,
    }),
  );

  const creativeDrafts = pkg ? buildCreativeFactoryDrafts({ destination: pkg.destination || '', productTitle: pkg.title }) : [];
  const tenantPackaging = buildTenantSaasPackaging({
    monthlyBudgetCapKrw: Number(workspace?.monthly_budget_cap_krw || budgets.reduce((sum, row) => sum + row.monthly_budget_krw, 0)),
    dailyBudgetCapKrw: Number(workspace?.daily_budget_cap_krw || budgets.reduce((sum, row) => sum + row.daily_budget_cap_krw, 0)),
    automationLevel: Number(workspace?.automation_level || Math.max(0, ...budgets.map((row) => row.automation_level))),
    requireHumanApproval: workspace?.require_human_approval !== false,
    fullAutoEnabled: workspace?.full_auto_enabled === true,
    forbiddenPhrases: (workspace?.forbidden_phrases as string[] | undefined) || [],
    marginRoasPct: sampleFunnel.margin_roas_pct,
    cpaKrw: spend,
  });

  const proposedRequests = [
    ...publisher.naver.requiredChangeRequests.map((req) =>
      changeRequestRow({
        tenantId,
        platform: 'naver',
        automationLevel: naverBudget?.automation_level,
        requestType: req.requestType,
        targetTable: 'search_ad_keyword_plans',
        targetId: keywords[0]?.id || 'naver-paused-batch',
        reason: req.reason,
        proposedChange: req.proposedChange,
        rollbackPayload: req.rollbackPayload,
        expectedImpact: { publisher_state: publisher.naver.state },
      }),
    ),
    ...publisher.google.requiredChangeRequests.map((req) =>
      changeRequestRow({
        tenantId,
        platform: 'google',
        automationLevel: googleBudget?.automation_level,
        requestType: req.requestType,
        targetTable: 'search_ad_keyword_plans',
        targetId: keywords[0]?.id || 'google-paused-batch',
        reason: req.reason,
        proposedChange: req.proposedChange,
        rollbackPayload: req.rollbackPayload,
        expectedImpact: { publisher_state: publisher.google.state },
      }),
    ),
    ...minedKeywords.slice(0, 10).map((keyword) =>
      changeRequestRow({
        tenantId,
        platform: 'naver',
        automationLevel: naverBudget?.automation_level,
        requestType: 'create_keyword',
        targetTable: 'search_ad_keyword_plans',
        targetId: pkg?.id || 'keyword-mining-batch',
        reason: keyword.rationale,
        proposedChange: { keyword_text: keyword.keyword, match_type: keyword.matchType, tier: keyword.tier, suggested_bid_krw: keyword.bidKrw },
        rollbackPayload: { plan_status: 'archived' },
        expectedImpact: { intent: keyword.intent },
      }),
    ),
    ...creativeDrafts.slice(0, 6).map((draft) =>
      changeRequestRow({
        tenantId,
        platform: draft.channel.includes('naver') ? 'naver' : 'meta',
        automationLevel: 2,
        requestType: 'create_creative_draft',
        targetTable: 'content_creatives',
        targetId: pkg?.id || 'creative-factory-batch',
        reason: draft.brief,
        proposedChange: draft,
        rollbackPayload: { status: 'rejected' },
        expectedImpact: { angle: draft.angle, publish_mode: draft.publishMode },
      }),
    ),
  ];

  let inserted = 0;
  if (apply && proposedRequests.length > 0) {
    const { data, error } = await supabaseAdmin.from('ad_os_change_requests').insert(proposedRequests).select('id');
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    inserted = data?.length || 0;
  }

  return NextResponse.json({
    ok: true,
    applied: apply,
    inserted_change_requests: inserted,
    package: pkg,
    publisher,
    measurement: {
      clean_events: conversions.length,
      revenue_krw: revenue,
      margin_krw: margin,
      cost_krw: spend,
      margin_roas_pct: sampleFunnel.margin_roas_pct,
      revenue_roas_pct: sampleFunnel.revenue_roas_pct,
      signal_policy: 'clean events only; test/admin/bot/negative-margin events are excluded or reviewed',
    },
    keyword_mining: {
      candidates: minedKeywords,
      waste_terms: wasteTerms.slice(0, 20),
      winning_terms: winningTerms.slice(0, 20),
      duplicate_content_action: duplicateAction,
    },
    pacing,
    creative_factory: {
      drafts: creativeDrafts,
      publish_policy: 'draft_only',
    },
    tenant_packaging: tenantPackaging,
    proposed_change_requests: proposedRequests,
  });
});
