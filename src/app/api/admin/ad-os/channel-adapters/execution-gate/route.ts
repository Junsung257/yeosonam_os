import { NextRequest, NextResponse } from 'next/server';
import { summarizeExecutionGates } from '@/lib/ad-os-v86-v100';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { loadExecutionGateInputs } from '../_gate';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const platform = ['naver', 'google', 'meta', 'kakao'].includes(String(body.platform)) ? String(body.platform) as 'naver' | 'google' | 'meta' | 'kakao' : 'naver';
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 100);
  const apply = body.apply !== false;
  const requestedMode = body.requested_mode || body.requestedMode || 'limited_autopilot';
  const humanApproved = body.human_approved === true || body.humanApproved === true;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'adapter_execution_gate',
      mode: 'dry_run',
      status: 'running',
      summary: { platform, limit, requested_mode: requestedMode, external_api_write: false },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  try {
    const { gates } = await loadExecutionGateInputs({
      platform,
      limit,
      humanApproved,
      requestedMode,
      runId: run.id,
    });
    const summary = summarizeExecutionGates(gates, []);

    if (apply) {
      const { error: insertError } = await supabaseAdmin
        .from('ad_os_adapter_execution_gates')
        .insert(gates as never);
      if (insertError) throw insertError;
    }

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
      .eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, summary, gates });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'execution gate failed';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
