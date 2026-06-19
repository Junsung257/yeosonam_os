import { NextRequest, NextResponse } from 'next/server';
import { summarizeAdapterCapabilities } from '@/lib/ad-os-v76-v85';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { adapterHealthRows, loadAdapterCapabilities } from '../_shared';

export const dynamic = 'force-dynamic';

function degradedHealthResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'adapter health unavailable';
  console.warn('[ad-os/channel-adapters/health] degraded response:', message);
  return NextResponse.json(
    {
      ok: false,
      degraded: true,
      reason: 'adapter_health_unavailable',
      error: message,
      summary: summarizeAdapterCapabilities([]),
      capabilities: [],
    },
    { status: 503 },
  );
}

async function buildResponse(apply: boolean) {
  if (!isSupabaseConfigured) {
    return degradedHealthResponse(new Error('Supabase not configured'));
  }

  try {
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
        return degradedHealthResponse(new Error(runError?.message || 'run create failed'));
      }

      const { error: insertError } = await supabaseAdmin
        .from('ad_os_channel_adapter_health')
        .insert(adapterHealthRows(capabilities) as never);

      if (insertError) {
        await supabaseAdmin
          .from('ad_os_automation_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: insertError.message }] })
          .eq('id', run.id);
        return degradedHealthResponse(insertError);
      }

      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
        .eq('id', run.id);

      return NextResponse.json({ ok: true, run_id: run.id, summary, capabilities });
    }

    return NextResponse.json({ ok: true, summary, capabilities });
  } catch (error) {
    return degradedHealthResponse(error);
  }
}

export const GET = withAdminGuard(async () => buildResponse(false));

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  return buildResponse(body.apply !== false);
});
