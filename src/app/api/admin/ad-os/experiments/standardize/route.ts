import { NextRequest, NextResponse } from 'next/server';
import { buildExperimentTemplates } from '@/lib/ad-os-v61-v75';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }
  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const tenantId = body.tenant_id || null;
  const templates = buildExperimentTemplates(tenantId);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'experiment_standardize',
      mode: apply ? 'upsert' : 'dry_run',
      status: 'running',
      summary: { apply, tenant_id: tenantId, templates: templates.length },
    })
    .select('id')
    .single();
  if (runError || !run) return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });

  if (apply) {
    const { error } = await supabaseAdmin
      .from('ad_os_experiment_templates')
      .upsert(templates as never, { onConflict: tenantId ? 'tenant_id,template_key' : 'template_key' });
    if (error) {
      await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] }).eq('id', run.id);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  const summary = {
    templates_prepared: templates.length,
    templates_written: apply ? templates.length : 0,
    minimum_clicks_total: templates.reduce((sum, template) => sum + template.minimum_clicks, 0),
    auto_winner_disabled: true,
  };
  await supabaseAdmin.from('ad_os_automation_runs').update({ status: 'completed', finished_at: new Date().toISOString(), summary }).eq('id', run.id);
  return NextResponse.json({ ok: true, run_id: run.id, summary, templates });
});
