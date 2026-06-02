import { NextRequest, NextResponse } from 'next/server';
import { buildGoogleConversionExportPackets, summarizeConversionPackets } from '@/lib/ad-os-v31-v40';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const limit = Math.min(Math.max(Number(body.limit || 100), 1), 500);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'conversion_ingest',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { platform: 'google', apply, limit, external_api_write: false },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const { data: events, error } = await supabaseAdmin
    .from('ad_os_conversion_events')
    .select('*')
    .in('event_type', ['lead', 'booking', 'revenue', 'margin', 'settlement_confirmed'])
    .order('event_time', { ascending: false })
    .limit(limit);

  if (error) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const packets = buildGoogleConversionExportPackets(events || []);
  const summary = summarizeConversionPackets(packets);
  const readyPackets = packets.filter((packet) => packet.ready_for_upload);

  if (apply && readyPackets.length > 0) {
    const { error: requestError } = await supabaseAdmin.from('ad_os_change_requests').insert(
      readyPackets.map((packet) => ({
        tenant_id: null,
        run_id: run.id,
        platform: 'google',
        automation_level: 2,
        request_type: 'upload_conversion_signal',
        target_table: 'ad_os_conversion_events',
        target_id: packet.event_id,
        status: 'proposed',
        title: 'Google 전환 업로드 승인 후보',
        reason: 'Google Ads Enhanced Conversions/Offline Conversion 업로드 가능한 clean 전환 신호입니다.',
        risk_level: 'medium',
        expected_impact: json({ value_krw: packet.value_krw, margin_krw: packet.margin_krw }),
        proposed_change: json({ platform_upload: 'google', packet, external_api_write: false }),
        rollback_payload: json({ no_external_write: true }),
        approval_required: true,
      })),
    );
    if (requestError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: requestError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: requestError.message }, { status: 500 });
    }
  }

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      summary: { ...summary, platform: 'google', change_requests_created: apply ? readyPackets.length : 0, external_api_write: false },
    })
    .eq('id', run.id);

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    summary: { ...summary, change_requests_created: apply ? readyPackets.length : 0, external_api_write: false },
    packets: packets.slice(0, 50),
  });
});
