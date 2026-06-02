import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { envFlagEnabled, loadLatestNaverLimitedPilotPolicy } from '@/lib/ad-os-v121-v140-db';
import { evaluateLegacyNaverPublisherInterlock } from '@/lib/ad-os-v121-v140';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { fetchNaverAdgroupById, getNaverAdsConfigStatus } from '@/lib/search-ads-api';

export const dynamic = 'force-dynamic';

type KeywordRow = {
  id: string;
  keyword_text: string;
  suggested_bid_krw: number | null;
  external_keyword_id: string | null;
  external_ad_group_id: string | null;
  autopilot_status: string | null;
  plan_status: string | null;
};

function jsonState(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value));
}

function getNaverAdgroupId(): string {
  return (
    process.env.NAVER_ADS_ADGROUP_ID ||
    process.env.NAVER_ADS_NCC_ADGROUP_ID ||
    ''
  ).trim();
}

function blockedReason(input: {
  naverConfigured: boolean;
  nccAdgroupId: string;
  adgroupReady: boolean;
  budgetReady: boolean;
  accountPublishAllowed: boolean;
  bidAllowed: boolean;
  interlockBlocker?: string | null;
}) {
  if (!input.naverConfigured) return 'naver_credentials_missing';
  if (!input.accountPublishAllowed) return 'tenant_account_not_publishable';
  if (!input.nccAdgroupId) return 'naver_adgroup_id_missing';
  if (!input.adgroupReady) return 'naver_adgroup_not_verified';
  if (!input.budgetReady) return 'naver_budget_not_ready';
  if (!input.bidAllowed) return 'max_cpc_exceeded';
  return input.interlockBlocker || 'guardrail';
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 100);
  const naverConfig = getNaverAdsConfigStatus();

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'candidate_generation',
      mode,
      platform: 'naver',
      status: 'running',
      summary: { apply, limit, publisher: 'naver_paused_keyword_publish', external_api_write: false },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'Naver publisher run create failed' }, { status: 500 });
  }

  try {
    const [budgetRes, tenantAccountRes, keywordRes, limitedPilotPolicy] = await Promise.all([
      supabaseAdmin
        .from('ad_os_channel_budgets')
        .select('platform,status,monthly_budget_krw,daily_budget_cap_krw,max_cpc_krw,external_ad_group_id')
        .eq('platform', 'naver')
        .maybeSingle(),
      supabaseAdmin
        .from('ad_os_tenant_ad_accounts')
        .select('connection_status, external_ad_group_id, can_publish_keywords, can_change_bids, can_pause_assets, risk_status')
        .is('tenant_id', null)
        .eq('platform', 'naver')
        .eq('account_mode', 'agency_managed')
        .maybeSingle(),
      supabaseAdmin
        .from('search_ad_keyword_plans')
        .select('id, keyword_text, suggested_bid_krw, external_keyword_id, external_ad_group_id, autopilot_status, plan_status')
        .eq('platform', 'naver')
        .eq('plan_status', 'approved')
        .in('autopilot_status', ['approved', 'testing'])
        .neq('tier', 'negative')
        .is('external_keyword_id', null)
        .order('created_at', { ascending: true })
        .limit(limit),
      loadLatestNaverLimitedPilotPolicy(),
    ]);

    const firstError = budgetRes.error || tenantAccountRes.error || keywordRes.error;
    if (firstError) throw firstError;

    const budget = budgetRes.data as {
      status?: string;
      monthly_budget_krw?: number;
      daily_budget_cap_krw?: number;
      max_cpc_krw?: number;
      external_ad_group_id?: string | null;
    } | null;
    const tenantAccount = tenantAccountRes.data as {
      connection_status?: string | null;
      external_ad_group_id?: string | null;
      can_publish_keywords?: boolean | null;
      risk_status?: string | null;
    } | null;
    const nccAdgroupId = String(body.nccAdgroupId || budget?.external_ad_group_id || tenantAccount?.external_ad_group_id || getNaverAdgroupId()).trim();
    const adgroupVerification = nccAdgroupId ? await fetchNaverAdgroupById(nccAdgroupId) : null;
    const budgetReady = Boolean(
      budget &&
        budget.status === 'active' &&
        Number(budget.monthly_budget_krw) > 0 &&
        Number(budget.daily_budget_cap_krw) > 0,
    );
    const accountPublishAllowed = Boolean(
      tenantAccount &&
        tenantAccount.connection_status === 'ready' &&
        tenantAccount.can_publish_keywords &&
        !['restricted', 'blocked'].includes(tenantAccount.risk_status || ''),
    );
    const adgroupReady = Boolean(adgroupVerification?.ok && adgroupVerification.adgroup);
    const ready = naverConfig.configured && accountPublishAllowed && Boolean(nccAdgroupId) && adgroupReady;
    const rows = (keywordRes.data || []) as KeywordRow[];
    const maxCpc = Number(budget?.max_cpc_krw || 0);
    const allowedRows = rows.filter((row) => maxCpc <= 0 || Number(row.suggested_bid_krw || 0) <= maxCpc);
    const blockedByCpc = rows.length - allowedRows.length;
    const canPublish = ready && budgetReady && allowedRows.length > 0;
    const interlock = evaluateLegacyNaverPublisherInterlock({
      action: 'publish_paused_keyword',
      mode,
      apply,
      canPublish,
      policy: limitedPilotPolicy,
      limitedPilotEnvEnabled: envFlagEnabled(limitedPilotPolicy?.env_flag_required),
      confirmLiveWrite: body.confirm_live_write === true,
    });

    const decisions = rows.map((row) => {
      const bid = Number(row.suggested_bid_krw || 0);
      const bidAllowed = maxCpc <= 0 || bid <= maxCpc;
      const eligible = ready && budgetReady && bidAllowed && interlock.allowed;
      const reason = eligible
        ? 'Naver paused keyword is eligible for the audited limited executor. Legacy publisher does not call the external API directly.'
        : interlock.requested_external_api_write && interlock.blockers.length > 0
          ? interlock.next_action
          : 'Naver paused keyword publish is blocked until credentials, account, ad group, budget, CPC, and limited-pilot controls pass.';

      return {
        run_id: run.id,
        platform: 'naver',
        decision_type: eligible ? 'start_test' : 'no_change',
        target_table: 'search_ad_keyword_plans',
        target_id: row.id,
        before_state: jsonState({ autopilot_status: row.autopilot_status, external_keyword_id: row.external_keyword_id, bid }),
        after_state: jsonState({
          external_publish: eligible ? 'limited_executor_ready' : 'blocked',
          ncc_adgroup_id: nccAdgroupId || null,
          external_api_write: false,
        }),
        reason,
        confidence: eligible ? 0.82 : 0.64,
        expected_impact: jsonState({
          user_lock: true,
          bid_krw: bid,
          max_cpc_krw: maxCpc,
          legacy_interlock: interlock.blockers,
          external_api_write: false,
        }),
        applied: false,
        blocked_reason: eligible ? null : blockedReason({
          naverConfigured: naverConfig.configured,
          nccAdgroupId,
          adgroupReady,
          budgetReady,
          accountPublishAllowed,
          bidAllowed,
          interlockBlocker: interlock.blockers[0],
        }),
      };
    });

    if (decisions.length > 0) {
      const { error } = await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);
      if (error) throw error;
    }

    const summary = {
      checked_keywords: rows.length,
      eligible_keywords: decisions.filter((row) => row.decision_type === 'start_test').length,
      blocked_keywords: decisions.filter((row) => row.decision_type !== 'start_test').length,
      blocked_by_cpc: blockedByCpc,
      naver_configured: naverConfig.configured,
      ncc_adgroup_id_configured: Boolean(nccAdgroupId),
      ncc_adgroup_id_verified: adgroupReady,
      ncc_adgroup_lookup_error: adgroupVerification?.ok === false ? adgroupVerification.error : null,
      tenant_account_ready: accountPublishAllowed,
      tenant_account_status: tenantAccount?.connection_status || 'not_connected',
      budget_ready: budgetReady,
      created_keywords: 0,
      applied: false,
      publish_error: null,
      legacy_publisher_delegated: apply && canPublish && interlock.allowed,
      external_api_write: false,
      legacy_interlock: {
        requested_external_api_write: interlock.requested_external_api_write,
        allowed_for_future_executor: interlock.allowed,
        blockers: interlock.blockers,
        next_action: interlock.next_action,
        policy_snapshot: interlock.policy_snapshot,
      },
    };

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({
        status: interlock.requested_external_api_write && !interlock.allowed ? 'blocked' : 'completed',
        finished_at: new Date().toISOString(),
        summary,
        errors: [],
      })
      .eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, summary, decisions: decisions.slice(0, 30) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Naver paused keyword publisher failed';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
