import { NextRequest, NextResponse } from 'next/server';
import { activateNaverKeyword, getNaverAdsConfigStatus } from '@/lib/search-ads-api';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type KeywordRow = {
  id: string;
  keyword_text: string;
  external_keyword_id: string | null;
  autopilot_status: string | null;
  plan_status: string | null;
};

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body.mode === 'guarded' || body.mode === 'full' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 100);
  const config = getNaverAdsConfigStatus();

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'external_publish',
      mode,
      platform: 'naver',
      status: 'running',
      summary: { source: 'naver_activate_paused_v13', apply, limit },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const [budgetRes, accountRes, keywordRes, requestRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('status,monthly_budget_krw,daily_budget_cap_krw,max_test_loss_krw,automation_level')
      .eq('platform', 'naver')
      .maybeSingle(),
    supabaseAdmin
      .from('ad_os_tenant_ad_accounts')
      .select('connection_status,can_publish_keywords,can_pause_assets,risk_status')
      .is('tenant_id', null)
      .eq('platform', 'naver')
      .maybeSingle(),
    supabaseAdmin
      .from('search_ad_keyword_plans')
      .select('id,keyword_text,external_keyword_id,autopilot_status,plan_status')
      .eq('platform', 'naver')
      .not('external_keyword_id', 'is', null)
      .in('autopilot_status', ['testing', 'approved'])
      .limit(limit),
    supabaseAdmin
      .from('ad_os_change_requests')
      .select('id,target_id,request_type,status')
      .eq('platform', 'naver')
      .eq('request_type', 'activate_paused_keyword')
      .eq('status', 'approved')
      .limit(limit),
  ]);

  const firstError = budgetRes.error || accountRes.error || keywordRes.error || requestRes.error;
  if (firstError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: firstError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const budget = budgetRes.data as {
    status?: string;
    monthly_budget_krw?: number;
    daily_budget_cap_krw?: number;
    automation_level?: number;
  } | null;
  const account = accountRes.data as {
    connection_status?: string | null;
    can_publish_keywords?: boolean | null;
    risk_status?: string | null;
  } | null;
  const keywords = (keywordRes.data || []) as KeywordRow[];
  const approvedActivationRequests = requestRes.data || [];
  const budgetReady = Boolean(
    budget &&
      budget.status === 'active' &&
      Number(budget.monthly_budget_krw || 0) > 0 &&
      Number(budget.daily_budget_cap_krw || 0) > 0,
  );
  const accountReady = Boolean(
    account &&
      ['ready', 'credentials_ready'].includes(account.connection_status || '') &&
      account.can_publish_keywords &&
      !['restricted', 'blocked'].includes(account.risk_status || ''),
  );
  const approvalReady = approvedActivationRequests.length > 0;
  const automationReady = Number(budget?.automation_level || 0) >= 2;
  const canActivate = config.configured && budgetReady && accountReady && approvalReady && automationReady && keywords.length > 0;

  const decisions = keywords.map((keyword) => ({
    run_id: run.id,
    platform: 'naver',
    decision_type: canActivate ? 'start_test' : 'no_change',
    target_table: 'search_ad_keyword_plans',
    target_id: keyword.id,
    before_state: {
      external_keyword_id: keyword.external_keyword_id,
      autopilot_status: keyword.autopilot_status,
      external_user_lock: true,
    },
    after_state: {
      autopilot_status: canActivate ? 'active' : keyword.autopilot_status,
      external_user_lock: canActivate ? false : true,
    },
    reason: canActivate
      ? 'Approved paused Naver keyword can be activated within budget, account, and tenant guardrails.'
      : 'Activation blocked until Naver credentials, account permission, active budget, approved activation request, and automation level are ready.',
    confidence: canActivate ? 0.84 : 0.6,
    expected_impact: { mode, apply, external_api_write: apply && canActivate },
    applied: false,
    blocked_reason: canActivate ? null : 'guardrail',
  }));

  if (decisions.length > 0) await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);

  const activatedIds: string[] = [];
  const failed: Array<{ keyword_id: string; external_keyword_id: string | null }> = [];
  if (apply && canActivate) {
    for (const keyword of keywords) {
      const externalId = keyword.external_keyword_id;
      if (!externalId) continue;
      const ok = await activateNaverKeyword(externalId);
      if (!ok) {
        failed.push({ keyword_id: keyword.id, external_keyword_id: externalId });
        continue;
      }
      activatedIds.push(keyword.id);
    }

    if (activatedIds.length > 0) {
      await supabaseAdmin
        .from('search_ad_keyword_plans')
        .update({
          autopilot_status: 'active',
          last_decision_at: new Date().toISOString(),
          decision_reason: 'Activated from paused Naver keyword by Ad OS V13 guarded publisher.',
          updated_at: new Date().toISOString(),
        })
        .in('id', activatedIds);
      await supabaseAdmin
        .from('ad_os_decision_logs')
        .update({ applied: true })
        .eq('run_id', run.id)
        .in('target_id', activatedIds);
      await supabaseAdmin
        .from('ad_os_change_requests')
        .update({ status: 'applied', applied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('id', approvedActivationRequests.map((row) => row.id));
    }
  }

  const summary = {
    mode,
    apply,
    checked_keywords: keywords.length,
    approved_activation_requests: approvedActivationRequests.length,
    can_activate: canActivate,
    activated_keywords: activatedIds.length,
    failed_keywords: failed.length,
    external_api_write: apply && canActivate,
    guardrails: {
      naver_configured: config.configured,
      budget_ready: budgetReady,
      account_ready: accountReady,
      approval_ready: approvalReady,
      automation_ready: automationReady,
    },
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({
      status: failed.length > 0 ? 'failed' : 'completed',
      finished_at: new Date().toISOString(),
      summary,
      errors: failed.length > 0 ? failed : [],
    })
    .eq('id', run.id);

  return NextResponse.json({ ok: failed.length === 0, run_id: run.id, summary, decisions: decisions.slice(0, 30), failed });
});
