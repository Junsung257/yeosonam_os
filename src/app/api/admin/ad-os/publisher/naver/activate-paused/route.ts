import { NextRequest, NextResponse } from 'next/server';
import { envFlagEnabled, loadLatestNaverLimitedPilotPolicy } from '@/lib/ad-os-v121-v140-db';
import { evaluateLegacyNaverPublisherInterlock } from '@/lib/ad-os-v121-v140';
import { getNaverAdsConfigStatus } from '@/lib/search-ads-api';
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
    return NextResponse.json({ ok: false, error: 'Supabase 연동이 설정되지 않았습니다.' }, { status: 503 });
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
      summary: { source: 'naver_activate_paused_v121_interlocked', apply, limit, external_api_write: false },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  try {
    const [budgetRes, accountRes, keywordRes, requestRes, limitedPilotPolicy] = await Promise.all([
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
      loadLatestNaverLimitedPilotPolicy(),
    ]);

    const firstError = budgetRes.error || accountRes.error || keywordRes.error || requestRes.error;
    if (firstError) throw firstError;

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
    const interlock = evaluateLegacyNaverPublisherInterlock({
      action: 'activate_paused_keyword',
      mode,
      apply,
      canPublish: canActivate,
      policy: limitedPilotPolicy,
      limitedPilotEnvEnabled: envFlagEnabled(limitedPilotPolicy?.env_flag_required),
      activeKeywordEnvEnabled: envFlagEnabled('AD_OS_NAVER_ACTIVE_KEYWORD_ENABLED'),
      confirmLiveWrite: body.confirm_live_write === true,
      confirmActiveSpend: body.confirm_active_spend === true,
    });

    const decisions = keywords.map((keyword) => ({
      run_id: run.id,
      platform: 'naver',
      decision_type: canActivate && interlock.allowed ? 'start_test' : 'no_change',
      target_table: 'search_ad_keyword_plans',
      target_id: keyword.id,
      before_state: {
        external_keyword_id: keyword.external_keyword_id,
        autopilot_status: keyword.autopilot_status,
        external_user_lock: true,
      },
      after_state: {
        autopilot_status: canActivate && interlock.allowed ? 'active_ready_for_executor' : keyword.autopilot_status,
        external_user_lock: true,
        external_api_write: false,
      },
      reason: canActivate && interlock.allowed
        ? 'Naver paused keyword activation is eligible for a future audited active-spend executor. Legacy publisher does not call the external API directly.'
        : interlock.requested_external_api_write && interlock.blockers.length > 0
          ? interlock.next_action
          : 'Activation blocked until Naver credentials, account permission, active budget, approved activation request, automation level, and active-spend controls are ready.',
      confidence: canActivate && interlock.allowed ? 0.84 : 0.6,
      expected_impact: {
        mode,
        apply,
        external_api_write: false,
        legacy_interlock: interlock.blockers,
      },
      applied: false,
      blocked_reason: canActivate && interlock.allowed ? null : interlock.blockers[0] || 'guardrail',
    }));

    if (decisions.length > 0) {
      const { error } = await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);
      if (error) throw error;
    }

    const summary = {
      mode,
      apply,
      checked_keywords: keywords.length,
      approved_activation_requests: approvedActivationRequests.length,
      can_activate: canActivate,
      activated_keywords: 0,
      failed_keywords: 0,
      external_api_write: false,
      legacy_publisher_delegated: apply && canActivate && interlock.allowed,
      guardrails: {
        naver_configured: config.configured,
        budget_ready: budgetReady,
        account_ready: accountReady,
        approval_ready: approvalReady,
        automation_ready: automationReady,
      },
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

    return NextResponse.json({ ok: true, run_id: run.id, summary, decisions: decisions.slice(0, 30), failed: [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Naver activation publisher failed';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
