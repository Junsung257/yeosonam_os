import { NextRequest } from 'next/server';
import { classifyAdOsChannelState, hasGoogleAdsCredentials, hasNaverSearchAdsCredentials } from '@/lib/ad-os-v3-v7';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type ExternalPublishBody = {
  platform?: 'naver' | 'google';
  change_request_ids?: string[];
  mode?: 'dry_run' | 'guarded' | 'full';
  apply?: boolean;
  limit?: number;
};

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as ExternalPublishBody;
  const platform = body.platform || 'naver';
  const mode = body.mode === 'full' || body.mode === 'guarded' ? body.mode : 'dry_run';
  const apply = mode !== 'dry_run' && body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 30), 1), 100);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'external_publish',
      mode,
      platform,
      status: 'running',
      summary: { apply, platform, source: 'external_publish_v1' },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return apiResponse({ ok: false, error: sanitizeDbError(runError, 'Run create failed') }, { status: 500 });
  }

  const [budgetRes, accountRes, requestRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('*')
      .eq('platform', platform)
      .limit(1),
    supabaseAdmin
      .from('ad_os_tenant_ad_accounts')
      .select('*')
      .eq('platform', platform)
      .limit(1),
    supabaseAdmin
      .from('ad_os_change_requests')
      .select('*')
      .eq('platform', platform)
      .in('status', ['approved'])
      .in('request_type', ['create_keyword', 'pause_keyword', 'create_campaign', 'sync_external_asset'])
      .order('created_at', { ascending: true })
      .limit(limit),
  ]);

  const firstError = budgetRes.error || accountRes.error || requestRes.error;
  if (firstError) {
    const safeError = sanitizeDbError(firstError);
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: safeError }] })
      .eq('id', run.id);
    return apiResponse({ ok: false, error: safeError }, { status: 500 });
  }

  const budget = budgetRes.data?.[0] as { status?: string; monthly_budget_krw?: number; daily_budget_cap_krw?: number; external_campaign_id?: string | null; external_ad_group_id?: string | null } | undefined;
  const account = accountRes.data?.[0] as { connection_status?: string | null; external_campaign_id?: string | null; external_ad_group_id?: string | null } | undefined;
  const channelState = classifyAdOsChannelState({
    platform,
    credentialsReady: platform === 'naver' ? hasNaverSearchAdsCredentials() : hasGoogleAdsCredentials(),
    connectionStatus: account?.connection_status ?? null,
    hasCampaign: Boolean(budget?.external_campaign_id || account?.external_campaign_id),
    hasAdGroup: Boolean(budget?.external_ad_group_id || account?.external_ad_group_id || platform === 'google'),
    budgetReady: Boolean(
      budget &&
        budget.status === 'active' &&
        Number(budget.monthly_budget_krw || 0) > 0 &&
        Number(budget.daily_budget_cap_krw || 0) > 0,
    ),
    approvedAssets: requestRes.data?.length || 0,
  });

  const canPublish = channelState.state === 'executable';
  const appliedIds: string[] = [];
  const blockedReason = canPublish ? null : channelState.state;

  const decisions = (requestRes.data || []).map((changeRequest: { id: string; request_type: string; target_table: string; target_id: string; proposed_change?: unknown }) => ({
    run_id: run.id,
    platform,
    decision_type: canPublish ? 'start_test' : 'no_change',
    target_table: 'ad_os_change_requests',
    target_id: changeRequest.id,
    before_state: json({ status: 'approved', request_type: changeRequest.request_type }),
    after_state: json({
      status: apply && canPublish ? 'applied' : 'approved',
      external_publish: canPublish ? 'ready' : 'blocked',
      proposed_change: changeRequest.proposed_change || {},
    }),
    reason: canPublish
      ? `${channelState.label}: 승인된 변경요청을 외부 발행 대기/paused 상태로 반영할 수 있습니다.`
      : `${channelState.label}: ${channelState.reason}`,
    confidence: canPublish ? 0.82 : 0.62,
    expected_impact: json({ mode, platform, can_spend: channelState.canSpend }),
    applied: false,
    blocked_reason: blockedReason,
  }));

  if (decisions.length > 0) {
    await supabaseAdmin.from('ad_os_decision_logs').insert(decisions);
  }

  if (apply && canPublish) {
    for (const changeRequest of requestRes.data || []) {
      const { error } = await supabaseAdmin
        .from('ad_os_change_requests')
        .update({
          status: 'applied',
          applied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', changeRequest.id);
      if (error) {
        const safeError = sanitizeDbError(error);
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: safeError }] })
          .eq('id', run.id);
        return apiResponse({ ok: false, error: safeError }, { status: 500 });
      }
      appliedIds.push(changeRequest.id);
    }
    if (appliedIds.length > 0) {
      await supabaseAdmin
        .from('ad_os_decision_logs')
        .update({ applied: true })
        .eq('run_id', run.id)
        .in('target_id', appliedIds);
    }
  }

  const summary = {
    platform,
    mode,
    apply,
    channel_state: channelState,
    approved_requests: requestRes.data?.length || 0,
    applied_requests: appliedIds.length,
    external_api_write: false,
    note: 'This guarded publisher marks approved changes as applied only after channel gates pass. Real external API mutation remains behind channel-specific publisher implementations.',
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return apiResponse({ ok: true, run_id: run.id, summary, decisions });
});
