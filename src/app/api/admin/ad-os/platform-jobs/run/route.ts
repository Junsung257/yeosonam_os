import { NextRequest, NextResponse } from 'next/server';
import { buildPlatformJobRows, type PlatformGuardrailInput } from '@/lib/ad-os-v41-v60';
import { withAdminGuard } from '@/lib/admin-guard';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function naverReady() {
  return Boolean(getSecret('NAVER_ADS_API_KEY') && getSecret('NAVER_ADS_SECRET_KEY') && getSecret('NAVER_ADS_CUSTOMER_ID'));
}

function googleReady() {
  return Boolean(getSecret('GOOGLE_ADS_DEVELOPER_TOKEN') && getSecret('GOOGLE_ADS_CUSTOMER_ID'));
}

function metaReady() {
  return Boolean((getSecret('META_ACCESS_TOKEN') || getSecret('META_ADS_ACCESS_TOKEN')) && getSecret('META_AD_ACCOUNT_ID'));
}

function platformIntegrationReady(platform: string) {
  if (platform === 'naver') return naverReady();
  if (platform === 'google') return googleReady();
  if (platform === 'meta') return metaReady();
  return false;
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const execute = body.execute === true;
  const limit = Math.min(Math.max(Number(body.limit || 100), 1), 500);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'platform_job',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { apply, execute, external_api_write: false, limit },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const [mutationRes, budgetRes, accountRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_external_mutation_results')
      .select('*')
      .in('status', ['planned', 'requested'])
      .order('created_at', { ascending: true })
      .limit(limit),
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('*'),
    supabaseAdmin
      .from('ad_os_tenant_ad_accounts')
      .select('*'),
  ]);

  const firstError = mutationRes.error || budgetRes.error || accountRes.error;
  if (firstError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: firstError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: firstError.message }, { status: 500 });
  }

  const budgets = (budgetRes.data || []) as Array<Record<string, any>>;
  const accounts = (accountRes.data || []) as Array<Record<string, any>>;
  const guardrailsByPlatform = Object.fromEntries(
    ['naver', 'google', 'meta', 'kakao'].map((platform) => {
      const budget = budgets.find((row) => row.platform === platform);
      const account = accounts.find((row) => row.platform === platform);
      const connectionStatus = String(account?.connection_status || '');
      const integrationReady = platformIntegrationReady(platform) || ['credentials_ready', 'no_campaign', 'ready', 'permission_denied'].includes(connectionStatus);
      const permissionOk = ['credentials_ready', 'no_campaign', 'ready'].includes(connectionStatus) || platformIntegrationReady(platform);
      const campaignReady = Boolean(budget?.external_campaign_id || account?.external_campaign_id) &&
        (platform === 'meta' || Boolean(budget?.external_ad_group_id || account?.external_ad_group_id));
      const budgetReady = Boolean(
        budget &&
          budget.status === 'active' &&
          Number(budget.monthly_budget_krw || 0) > 0 &&
          Number(budget.daily_budget_cap_krw || 0) > 0,
      );
      const guardrails: PlatformGuardrailInput = {
        integrationReady,
        permissionOk,
        campaignReady,
        budgetReady,
        killSwitchClear: !['paused', 'blocked'].includes(String(budget?.status || '')),
        automationLevel: Number(budget?.automation_level || 0),
        humanApproved: true,
        fullAutoEnabled: Number(budget?.automation_level || 0) < 4,
      };
      return [platform, guardrails];
    }),
  );

  const jobs = buildPlatformJobRows(
    (mutationRes.data || []).map((mutation) => ({
      ...mutation,
      platform: String(mutation.platform || 'naver') as 'naver' | 'google' | 'meta' | 'kakao',
    })),
    guardrailsByPlatform,
    { runId: run.id, execute },
  );

  if (apply && jobs.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from('ad_os_platform_jobs')
      .upsert(jobs, { onConflict: 'platform,idempotency_key' });
    if (insertError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: insertError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }
  }

  const summary = {
    mutations_checked: mutationRes.data?.length || 0,
    jobs: jobs.length,
    jobs_prepared: jobs.length,
    jobs_written: apply ? jobs.length : 0,
    approved: jobs.filter((row) => row.status === 'approved').length,
    running: jobs.filter((row) => row.status === 'running').length,
    blocked: jobs.filter((row) => row.status === 'blocked').length,
    external_api_write: false,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, jobs: jobs.slice(0, 50) });
});
