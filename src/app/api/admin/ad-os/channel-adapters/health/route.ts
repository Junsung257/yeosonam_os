import { NextRequest, NextResponse } from 'next/server';
import { summarizeAdapterCapabilities } from '@/lib/ad-os-v76-v85';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { adapterHealthRows, loadAdapterCapabilities } from '../_shared';

export const dynamic = 'force-dynamic';

async function buildResponse(apply: boolean) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const capabilities = await loadAdapterCapabilities();
  const summary = summarizeAdapterCapabilities(capabilities);

  if (apply) {
    const { data: run, error: runError } = await supabaseAdmin
      .from('ad_os_automation_runs')
      .insert({
        run_type: 'channel_adapter_health',
        mode: 'dry_run',
        status: 'running',
        summary: { platforms: capabilities.length, external_api_write: false },
      })
      .select('id')
      .single();

    if (runError || !run) {
      return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
    }

    const { error: insertError } = await supabaseAdmin
      .from('ad_os_channel_adapter_health')
      .insert(adapterHealthRows(capabilities) as never);

    if (insertError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: insertError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
      .eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, summary, capabilities });
  }

  return NextResponse.json({ ok: true, summary, capabilities });
}

export const GET = withAdminGuard(async () => buildResponse(false));

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  return buildResponse(body.apply !== false);
});
