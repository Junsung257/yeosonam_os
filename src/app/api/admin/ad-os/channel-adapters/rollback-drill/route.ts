import { NextRequest, NextResponse } from 'next/server';
import { buildRollbackDrill, summarizeExecutionGates, type ExecutionGateRow } from '@/lib/ad-os-v86-v100';
import type { PlatformWritePacket } from '@/lib/ad-os-v76-v85';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type GateDbRow = ExecutionGateRow & { id: string };
type PacketDbRow = PlatformWritePacket & { id: string };

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const platform = ['naver', 'google', 'meta', 'kakao'].includes(String(body.platform)) ? String(body.platform) as 'naver' | 'google' | 'meta' | 'kakao' : 'naver';
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 100);
  const apply = body.apply !== false;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'rollback_drill',
      mode: 'dry_run',
      status: 'running',
      summary: { platform, limit, external_api_write: false },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  try {
    const gateRes = await supabaseAdmin
      .from('ad_os_adapter_execution_gates')
      .select('*')
      .eq('platform', platform)
      .order('evaluated_at', { ascending: false })
      .limit(limit);

    if (gateRes.error) throw gateRes.error;
    const gates = (gateRes.data || []) as GateDbRow[];
    const packetIds = Array.from(new Set(gates.map((gate) => gate.packet_id).filter(Boolean))) as string[];
    const packetRes = packetIds.length > 0
      ? await supabaseAdmin.from('ad_os_platform_write_packets').select('*').in('id', packetIds)
      : { data: [], error: null };
    if (packetRes.error) throw packetRes.error;
    const packets = (packetRes.data || []) as PacketDbRow[];
    const packetsById = new Map(packets.map((packet) => [packet.id, packet]));

    const drills = gates.map((gate) => {
      const packet = gate.packet_id ? packetsById.get(gate.packet_id) || null : null;
      return {
        ...buildRollbackDrill({ gate, packet, runId: run.id }),
        gate_id: gate.id,
      };
    });
    const summary = summarizeExecutionGates(gates, drills);

    if (apply && drills.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('ad_os_rollback_drills')
        .insert(drills as never);
      if (insertError) throw insertError;
    }

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
      .eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, summary, drills });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'rollback drill failed';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
