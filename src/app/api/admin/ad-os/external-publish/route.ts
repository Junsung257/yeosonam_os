import { NextRequest, NextResponse } from 'next/server';
import { decideExternalPublishStaging } from '@/lib/ad-os-v161-v180';
import { classifyAdOsChannelState, hasGoogleAdsCredentials, hasNaverSearchAdsCredentials } from '@/lib/ad-os-v3-v7';
import { buildExternalMutationAuditRow } from '@/lib/ad-os-v26-v30';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type ExternalPublishBody = {
  platform?: 'naver' | 'google';
  change_request_ids?: string[];
  mode?: 'dry_run' | 'guarded' | 'full';
  apply?: boolean;
  confirm_external_result?: boolean;
  limit?: number;
};

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function byStatus(statuses: string[]): Record<string, number> {
  return statuses.reduce<Record<string, number>>((acc, status) => {
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase 미설정' }, { status: 503 });
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
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
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
      .select('id, tenant_id, request_type, target_table, target_id, proposed_change')
      .eq('platform', platform)
      .in('status', ['approved'])
      .in('request_type', ['create_keyword', 'pause_keyword', 'create_campaign', 'sync_external_asset', 'publish_paused_keyword'])
      .order('created_at', { ascending: true })
      .limit(limit),
  ]);

  const firstError = budgetRes.error || accountRes.error || requestRes.error;
  if (firstError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: firstError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const budget = budgetRes.data?.[0] as { status?: string; monthly_budget_krw?: number; daily_budget_cap_krw?: number; external_campaign_id?: string | null; external_ad_group_id?: string | null } | undefined;
  const account = accountRes.data?.[0] as {
    connection_status?: string | null;
    external_account_id?: string | null;
    external_campaign_id?: string | null;
    external_ad_group_id?: string | null;
  } | undefined;
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
  const blockedReason = canPublish ? null : channelState.state;
  const staging = decideExternalPublishStaging({
    apply,
    canPublish,
    requests: requestRes.data || [],
    externalApiWrite: false,
    confirmExternalResult: body.confirm_external_result === true,
  });

  const decisions = (requestRes.data || []).map((changeRequest: { id: string; request_type: string; target_table: string; target_id: string; proposed_change?: unknown }) => ({
    run_id: run.id,
    platform,
    decision_type: canPublish ? 'start_test' : 'no_change',
    target_table: 'ad_os_change_requests',
    target_id: changeRequest.id,
    before_state: json({ status: 'approved', request_type: changeRequest.request_type }),
    after_state: json({
      status: staging.mark_change_request_applied ? 'applied' : 'approved',
      executor_stage: staging.can_stage_for_executor ? 'staged_for_executor' : 'not_staged',
      applied_after_external_confirmation: staging.mark_change_request_applied,
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

  const mutationRows = (requestRes.data || []).map((changeRequest: any) =>
    buildExternalMutationAuditRow({
      runId: run.id,
      platform,
      mode,
      canPublish,
      errorMessage: blockedReason,
      changeRequest: {
        id: changeRequest.id,
        tenant_id: changeRequest.tenant_id || null,
        request_type: changeRequest.request_type || null,
        proposed_change: changeRequest.proposed_change || {},
      },
      account: {
        external_account_id: account?.external_account_id || null,
        external_campaign_id: budget?.external_campaign_id || account?.external_campaign_id || null,
        external_ad_group_id: budget?.external_ad_group_id || account?.external_ad_group_id || null,
      },
    }),
  );

  if (mutationRows.length > 0) {
    const { error: mutationError } = await supabaseAdmin
      .from('ad_os_external_mutation_results')
      .upsert(mutationRows, { onConflict: 'platform,idempotency_key', ignoreDuplicates: false });
    if (mutationError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: mutationError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: mutationError.message }, { status: 500 });
    }
  }

  const appliedIds: string[] = staging.applied_request_ids;
  const stagedIds: string[] = staging.staged_request_ids;

  const summary = {
    platform,
    mode,
    apply,
    channel_state: channelState,
    approved_requests: requestRes.data?.length || 0,
    staged_for_executor_requests: stagedIds.length,
    applied_requests: appliedIds.length,
    mutation_audit_rows: mutationRows.length,
    mutation_audit_status: byStatus(mutationRows.map((row) => row.status)),
    external_api_write: false,
    staging,
    note: 'This guarded publisher creates idempotent external mutation audit rows only. Approved changes stay approved until an audited executor confirms an external result; this route performs no external API write.',
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, decisions });
});
