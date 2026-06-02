import { NextRequest, NextResponse } from 'next/server';
import { buildConversionUploadJobRows } from '@/lib/ad-os-v41-v60';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const EVENT_TYPES = ['click', 'landing_view', 'cta_click', 'lead', 'booking', 'revenue', 'margin', 'settlement_confirmed'];

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const platform = ['google', 'meta'].includes(String(body.platform)) ? String(body.platform) as 'google' | 'meta' : 'google';
  const limit = Math.min(Math.max(Number(body.limit || 200), 1), 500);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'conversion_upload',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { apply, platform, limit, external_api_write: false },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const { data: events, error } = await supabaseAdmin
    .from('ad_os_conversion_events')
    .select('*')
    .in('event_type', EVENT_TYPES)
    .order('event_time', { ascending: false })
    .limit(limit);

  if (error) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const jobs = buildConversionUploadJobRows(events || [], platform, { runId: run.id });

  if (apply && jobs.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from('ad_os_conversion_upload_jobs')
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
    events_checked: events?.length || 0,
    jobs_prepared: jobs.length,
    jobs_written: apply ? jobs.length : 0,
    planned: jobs.filter((row) => row.status === 'planned').length,
    blocked: jobs.filter((row) => row.status === 'blocked').length,
    clean: jobs.filter((row) => row.status === 'planned').length,
    quarantined: jobs.filter((row) => row.status === 'blocked').length,
    avg_signal_quality_score: jobs.length > 0 ? Math.round(jobs.reduce((sum, row) => sum + row.signal_quality_score, 0) / jobs.length) : 0,
    external_api_write: false,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, jobs: jobs.slice(0, 50) });
});
