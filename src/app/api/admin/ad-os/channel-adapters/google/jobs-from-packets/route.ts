import { NextRequest, NextResponse } from 'next/server';
import {
  buildGoogleDraftPlatformJobFromPacket,
  type GoogleDraftGateForJob,
  type GoogleDraftPacketForJob,
} from '@/lib/ad-os-google-draft-jobs';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type JobInsertResult = {
  id: string;
  idempotency_key: string;
  status: string | null;
  blocked_reason: string | null;
};

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply !== false;
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  const limit = Math.min(Math.max(Number(body.limit || 50), 1), 200);
  const includeLinked = body.include_linked === true;

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'google_draft_packet_jobs',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: {
        platform: 'google',
        source: 'google_campaign_draft_packets',
        apply,
        external_api_write: false,
        external_spend_krw: 0,
        limit,
      },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  try {
    let packetQuery = supabaseAdmin
      .from('ad_os_platform_write_packets')
      .select('*')
      .eq('platform', 'google')
      .eq('packet_type', 'google_campaign_draft')
      .in('lifecycle_status', ['ready', 'queued'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (tenantId) packetQuery = packetQuery.eq('tenant_id', tenantId);
    if (!includeLinked) packetQuery = packetQuery.is('job_id', null);

    const { data: packetData, error: packetError } = await packetQuery;
    if (packetError) throw packetError;

    const packets = (packetData || []) as GoogleDraftPacketForJob[];
    const packetIds = packets.map((packet) => packet.id);
    const gateRes = packetIds.length > 0
      ? await supabaseAdmin
        .from('ad_os_adapter_execution_gates')
        .select('*')
        .eq('platform', 'google')
        .in('packet_id', packetIds)
        .order('evaluated_at', { ascending: false })
        .limit(Math.max(limit * 3, 50))
      : { data: [], error: null };
    if (gateRes.error) throw gateRes.error;

    const latestGateByPacket = new Map<string, GoogleDraftGateForJob>();
    for (const gate of (gateRes.data || []) as GoogleDraftGateForJob[]) {
      if (gate.packet_id && !latestGateByPacket.has(gate.packet_id)) {
        latestGateByPacket.set(gate.packet_id, gate);
      }
    }

    const jobs = packets.map((packet) =>
      buildGoogleDraftPlatformJobFromPacket({
        packet,
        gate: latestGateByPacket.get(packet.id) || null,
        runId: run.id,
      }),
    );

    let writtenJobs: JobInsertResult[] = [];
    if (apply && jobs.length > 0) {
      const { data, error } = await supabaseAdmin
        .from('ad_os_platform_jobs')
        .upsert(jobs as never, { onConflict: 'platform,idempotency_key' })
        .select('id, idempotency_key, status, blocked_reason');
      if (error) throw error;
      writtenJobs = (data || []) as JobInsertResult[];

      const jobByKey = new Map(writtenJobs.map((job) => [job.idempotency_key, job]));
      for (const packet of packets) {
        const key = `google-draft-job:${packet.idempotency_key}`.slice(0, 240);
        const job = jobByKey.get(key);
        if (!job) continue;
        const { error: updateError } = await supabaseAdmin
          .from('ad_os_platform_write_packets')
          .update({
            job_id: job.id,
            lifecycle_status: job.status === 'blocked' ? 'blocked' : 'queued',
            blocked_reason: job.blocked_reason,
            response_payload: {
              ...(packet.response_payload || {}),
              platform_job_id: job.id,
              platform_job_status: job.status,
              external_api_write: false,
              external_spend_krw: 0,
            },
          } as never)
          .eq('id', packet.id);
        if (updateError) throw updateError;
      }
    }

    const summary = {
      apply,
      packets_checked: packets.length,
      gates_found: latestGateByPacket.size,
      jobs_prepared: jobs.length,
      jobs_written: writtenJobs.length,
      approved_jobs: jobs.filter((job) => job.status === 'approved').length,
      blocked_jobs: jobs.filter((job) => job.status === 'blocked').length,
      external_api_write: false,
      external_spend_krw: 0,
    };

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
      .eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, dry_run: !apply, summary, jobs: jobs.slice(0, 50) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'google draft packet job preparation failed';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
