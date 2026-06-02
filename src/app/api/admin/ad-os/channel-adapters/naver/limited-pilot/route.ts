import { NextRequest, NextResponse } from 'next/server';
import {
  defaultLimitedWritePilotPolicy,
  evaluateLimitedWritePilot,
  summarizeLimitedWritePilot,
  type LimitedPilotRequestedMode,
  type LimitedWritePilotPolicy,
} from '@/lib/ad-os-v101-v120';
import type { PlatformWritePacket } from '@/lib/ad-os-v76-v85';
import type { ExecutionGateRow, RollbackDrillRow } from '@/lib/ad-os-v86-v100';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type PolicyRow = LimitedWritePilotPolicy & { id: string };
type GateDbRow = ExecutionGateRow & { id: string };
type PacketDbRow = PlatformWritePacket & { id: string };
type DrillDbRow = RollbackDrillRow & { id: string; gate_id?: string | null };

function envFlagEnabled(flagName?: string | null): boolean {
  const name = String(flagName || 'AD_OS_NAVER_LIMITED_WRITE_ENABLED').trim();
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function asRequestedMode(value: unknown): LimitedPilotRequestedMode {
  return value === 'live_paused_write' ? 'live_paused_write' : 'dry_run';
}

async function ensureDryRunPolicy(): Promise<PolicyRow | null> {
  const existing = await supabaseAdmin
    .from('ad_os_limited_write_pilot_policies')
    .select('*')
    .is('tenant_id', null)
    .eq('platform', 'naver')
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as PolicyRow;

  const [budgetRes, workspaceRes] = await Promise.all([
    supabaseAdmin
      .from('ad_os_channel_budgets')
      .select('monthly_budget_krw,daily_budget_cap_krw,max_cpc_krw,max_test_loss_krw')
      .eq('platform', 'naver')
      .maybeSingle(),
    supabaseAdmin
      .from('tenant_ad_workspaces')
      .select('monthly_budget_cap_krw,daily_budget_cap_krw,max_cpc_krw,max_test_loss_krw')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (budgetRes.error || workspaceRes.error) throw budgetRes.error || workspaceRes.error;
  const budget = budgetRes.data as Record<string, unknown> | null;
  const workspace = workspaceRes.data as Record<string, unknown> | null;

  const { data, error } = await supabaseAdmin
    .from('ad_os_limited_write_pilot_policies')
    .insert({
      platform: 'naver',
      status: 'active',
      pilot_level: 'dry_run_only',
      monthly_budget_cap_krw: Number(budget?.monthly_budget_krw || workspace?.monthly_budget_cap_krw || 0),
      daily_budget_cap_krw: Number(budget?.daily_budget_cap_krw || workspace?.daily_budget_cap_krw || 0),
      max_cpc_krw: Number(budget?.max_cpc_krw || workspace?.max_cpc_krw || 0),
      max_test_loss_krw: Number(budget?.max_test_loss_krw || workspace?.max_test_loss_krw || 0),
      require_gate_eligible: true,
      require_rollback_ready: true,
      require_human_approval: true,
      live_external_write_enabled: false,
      notes: 'Auto-created by Naver limited pilot dry-run. Live external write remains disabled.',
    } as never)
    .select('*')
    .single();

  if (error) throw error;
  return data as PolicyRow;
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 100);
  const apply = body.apply !== false;
  const requestedMode = asRequestedMode(body.requested_mode);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'limited_write_pilot',
      mode: requestedMode,
      platform: 'naver',
      status: 'running',
      summary: { platform: 'naver', requested_mode: requestedMode, external_api_write: false },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  try {
    const policy = body.ensure_policy === true
      ? await ensureDryRunPolicy()
      : (await supabaseAdmin
        .from('ad_os_limited_write_pilot_policies')
        .select('*')
        .is('tenant_id', null)
        .eq('platform', 'naver')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()).data as PolicyRow | null;

    const gateRes = await supabaseAdmin
      .from('ad_os_adapter_execution_gates')
      .select('*')
      .eq('platform', 'naver')
      .order('evaluated_at', { ascending: false })
      .limit(limit);
    if (gateRes.error) throw gateRes.error;

    const gates = (gateRes.data || []) as GateDbRow[];
    const packetIds = Array.from(new Set(gates.map((gate) => gate.packet_id).filter(Boolean))) as string[];
    const [packetRes, drillRes] = await Promise.all([
      packetIds.length > 0
        ? supabaseAdmin.from('ad_os_platform_write_packets').select('*').in('id', packetIds)
        : Promise.resolve({ data: [], error: null }),
      supabaseAdmin
        .from('ad_os_rollback_drills')
        .select('*')
        .eq('platform', 'naver')
        .order('drilled_at', { ascending: false })
        .limit(limit * 3),
    ]);

    if (packetRes.error || drillRes.error) throw packetRes.error || drillRes.error;

    const packetsById = new Map(((packetRes.data || []) as PacketDbRow[]).map((packet) => [packet.id, packet]));
    const drills = (drillRes.data || []) as DrillDbRow[];
    const latestDrillForGate = new Map<string, DrillDbRow>();
    const latestDrillForPacket = new Map<string, DrillDbRow>();
    for (const drill of drills) {
      if (drill.gate_id && !latestDrillForGate.has(drill.gate_id)) latestDrillForGate.set(drill.gate_id, drill);
      if (drill.packet_id && !latestDrillForPacket.has(drill.packet_id)) latestDrillForPacket.set(drill.packet_id, drill);
    }

    const evaluationPolicy = policy || defaultLimitedWritePilotPolicy();
    const attempts = gates.length > 0
      ? gates.map((gate) => {
        const packet = gate.packet_id ? packetsById.get(gate.packet_id) || null : null;
        const drill = latestDrillForGate.get(gate.id) || (gate.packet_id ? latestDrillForPacket.get(gate.packet_id) : null) || null;
        return evaluateLimitedWritePilot({
          policy: evaluationPolicy,
          packet,
          gate,
          rollbackDrill: drill,
          requestedMode,
          envFlagEnabled: envFlagEnabled(evaluationPolicy.env_flag_required),
          runId: run.id,
        });
      })
      : [evaluateLimitedWritePilot({
        policy: evaluationPolicy,
        requestedMode,
        envFlagEnabled: envFlagEnabled(evaluationPolicy.env_flag_required),
        runId: run.id,
      })];

    const summary = {
      ...summarizeLimitedWritePilot(attempts),
      policy_found: Boolean(policy),
      policy_status: evaluationPolicy.status,
      pilot_level: evaluationPolicy.pilot_level,
      requested_mode: requestedMode,
      external_api_write: false,
    };

    if (apply && attempts.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('ad_os_limited_write_pilot_attempts')
        .insert(attempts as never);
      if (insertError) throw insertError;
    }

    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
      .eq('id', run.id);

    return NextResponse.json({ ok: true, run_id: run.id, summary, attempts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'limited pilot failed';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
});
