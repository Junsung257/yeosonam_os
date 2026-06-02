import { NextRequest, NextResponse } from 'next/server';
import { gateNaverChangeRequests, type NaverExecutionMode } from '@/lib/ad-os-v31-v40';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function hasNaverSecrets() {
  return Boolean(getSecret('NAVER_ADS_API_KEY') && getSecret('NAVER_ADS_SECRET_KEY') && getSecret('NAVER_ADS_CUSTOMER_ID'));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = (['dry_run', 'paused_only', 'active_allowed'].includes(String(body.mode)) ? body.mode : 'dry_run') as NaverExecutionMode;
  const apply = body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'external_publish',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { platform: 'naver', mode, apply, external_api_write: false },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const [requestRes, budgetRes, accountRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_change_requests')
      .select('id, tenant_id, request_type, status, platform, automation_level, proposed_change')
      .eq('platform', 'naver')
      .eq('status', 'approved')
      .in('request_type', ['publish_paused_keyword', 'activate_paused_keyword', 'pause_keyword', 'increase_bid', 'decrease_bid', 'create_keyword'])
      .order('approved_at', { ascending: true })
      .limit(limit),
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('*')
      .eq('platform', 'naver')
      .maybeSingle(),
    supabaseAdmin
      .from('ad_os_tenant_ad_accounts')
      .select('*')
      .eq('platform', 'naver')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  if (requestRes.error || budgetRes.error || accountRes.error) {
    const error = requestRes.error || budgetRes.error || accountRes.error;
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error?.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: error?.message || 'query failed' }, { status: 500 });
  }

  const budget = budgetRes.data as Record<string, unknown> | null;
  const account = (accountRes.data || [])[0] as Record<string, unknown> | undefined;
  const connectionStatus = String(account?.connection_status || '');
  const permissionOk = ['credentials_ready', 'no_campaign', 'ready'].includes(connectionStatus) || hasNaverSecrets();
  const externalCampaignId = String(budget?.external_campaign_id || account?.external_campaign_id || '');
  const externalAdGroupId = String(budget?.external_ad_group_id || account?.external_ad_group_id || '');
  const automationLevel = Math.max(Number(budget?.automation_level || 0), ...((requestRes.data || []).map((row: { automation_level?: number | null }) => Number(row.automation_level || 0))));
  const guards = {
    integrationReady: hasNaverSecrets(),
    permissionOk,
    campaignReady: Boolean(externalCampaignId && externalAdGroupId),
    budgetReady: Boolean(
      budget &&
        budget.status === 'active' &&
        Number(budget.monthly_budget_krw || 0) > 0 &&
        Number(budget.daily_budget_cap_krw || 0) > 0 &&
        Number(budget.max_cpc_krw || 0) > 0,
    ),
    automationLevel,
  };
  const gates = gateNaverChangeRequests(requestRes.data || [], mode, guards);

  const mutationRows = gates.map((gate) => {
    const changeRequest = (requestRes.data || []).find((row: { id: string }) => row.id === gate.request_id);
    return {
      tenant_id: changeRequest?.tenant_id || null,
      platform: 'naver',
      mutation_type: gate.mutation_type,
      mode,
      status: gate.allowed && apply ? 'requested' : gate.allowed ? 'planned' : 'blocked',
      change_request_id: gate.request_id,
      run_id: run.id,
      external_account_id: String(budget?.external_account_id || account?.external_account_id || '') || null,
      external_campaign_id: externalCampaignId || null,
      external_ad_group_id: externalAdGroupId || null,
      external_keyword_id: null,
      idempotency_key: gate.idempotency_key,
      request_payload: json({
        change_request_id: gate.request_id,
        request_type: changeRequest?.request_type || null,
        proposed_change: changeRequest?.proposed_change || {},
        requested_mode: mode,
        external_api_write: false,
      }),
      response_payload: json({
        gate_allowed: gate.allowed,
        reason: gate.reason,
        existing_specialized_publishers: [
          '/api/admin/ad-os/channel-adapters/naver/limited-pilot',
          '/api/admin/ad-os/publish-naver-keywords (legacy interlocked)',
          '/api/admin/ad-os/publisher/naver/activate-paused (legacy interlocked)',
        ],
        v121_safety_note: 'Legacy Naver publishers are now interlocked and do not call external APIs directly.',
        external_api_write: false,
      }),
      error_message: gate.allowed ? null : gate.reason,
    };
  });

  if (mutationRows.length > 0) {
    const { error: mutationError } = await supabaseAdmin
      .from('ad_os_external_mutation_results')
      .upsert(mutationRows, { onConflict: 'platform,idempotency_key' });
    if (mutationError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: mutationError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: mutationError.message }, { status: 500 });
    }
  }

  const summary = {
    approved_requests_checked: requestRes.data?.length || 0,
    mode,
    external_api_write: false,
    planned: mutationRows.filter((row) => row.status === 'planned').length,
    requested: mutationRows.filter((row) => row.status === 'requested').length,
    blocked: mutationRows.filter((row) => row.status === 'blocked').length,
    guards,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, gates, mutations: mutationRows.slice(0, 50) });
});
