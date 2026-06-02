import { NextResponse } from 'next/server';
import type { AdapterCapability, AdOsAdapterPlatform, PacketSeed, PlatformWritePacket } from '@/lib/ad-os-v76-v85';
import { supabaseAdmin } from '@/lib/supabase';
import { loadAdapterCapabilities } from './_shared';

export async function createPacketResponse(input: {
  platform: AdOsAdapterPlatform;
  seed: PacketSeed;
  apply: boolean;
  build: (capability: AdapterCapability, seed: PacketSeed) => PlatformWritePacket;
}) {
  const capabilities = await loadAdapterCapabilities();
  const capability = capabilities.find((item) => item.platform === input.platform);
  if (!capability) {
    return NextResponse.json({ ok: false, error: `No ${input.platform} adapter capability found` }, { status: 500 });
  }

  const packet = input.build(capability, input.seed);
  if (!input.apply) {
    return NextResponse.json({ ok: true, summary: { written: 0, lifecycle_status: packet.lifecycle_status }, packet });
  }

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'platform_write_packet',
      mode: 'dry_run',
      status: 'running',
      summary: {
        platform: packet.platform,
        packet_type: packet.packet_type,
        lifecycle_status: packet.lifecycle_status,
        external_api_write: false,
      },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const row = { ...packet, run_id: run.id };
  const { error: upsertError } = await supabaseAdmin
    .from('ad_os_platform_write_packets')
    .upsert(row as never, { onConflict: 'platform,idempotency_key' });

  if (upsertError) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: upsertError.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: upsertError.message }, { status: 500 });
  }

  const summary = {
    written: 1,
    platform: row.platform,
    packet_type: row.packet_type,
    lifecycle_status: row.lifecycle_status,
    blocked_reason: row.blocked_reason,
    external_api_write: false,
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, packet: row });
}
