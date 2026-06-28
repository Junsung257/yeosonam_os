import { NextRequest, NextResponse } from 'next/server';
import {
  AD_OS_CHANNELS,
  buildAdDirectorRun,
  type AdDirectorRunMode,
  type AdDirectorDecision,
  type AdDirectorRun,
} from '@/lib/ad-os-ai-director';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { withTimeout } from '@/lib/promise-timeout';
import { fetchAdOsSummaryJson } from '../../_lib/summary-fetch';
import type { AdOsChangeRequestType } from '@/lib/ad-os-change-request';

export const dynamic = 'force-dynamic';

const AI_DIRECTOR_TIMEOUT_MS = 20000;

const DECISION_TYPE_BY_REQUEST: Record<AdOsChangeRequestType, string> = {
  create_keyword: 'create_candidate',
  pause_keyword: 'pause',
  increase_bid: 'increase_bid',
  decrease_bid: 'decrease_bid',
  budget_change: 'no_change',
  pause_channel: 'pause',
  replace_landing: 'replace_landing',
  create_landing: 'create_candidate',
  create_campaign: 'create_candidate',
  sync_external_asset: 'no_change',
  update_blog_cta: 'replace_landing',
  create_card_news: 'create_candidate',
  create_negative_keyword: 'add_negative',
  create_experiment: 'create_candidate',
  publish_paused_keyword: 'approve',
  upload_conversion_signal: 'no_change',
  activate_paused_keyword: 'start_test',
  sync_performance: 'no_change',
  create_creative_draft: 'create_candidate',
  update_tenant_policy: 'no_change',
};

function parseMode(value: unknown): AdDirectorRunMode {
  return value === 'guarded_l3' ? 'guarded_l3' : 'dry_run';
}

function parseChannels(value: unknown): string[] {
  if (!Array.isArray(value)) return [...AD_OS_CHANNELS];
  return value.map(String).filter((channel) => (AD_OS_CHANNELS as readonly string[]).includes(channel));
}

async function getSourceLedgerCount(): Promise<number> {
  if (!isSupabaseAdminConfigured) return 0;
  try {
    const { count, error } = await supabaseAdmin
      .from('ad_os_source_ledger')
      .select('id', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

function decisionLogRow(runId: string, decision: AdDirectorDecision) {
  return {
    run_id: runId,
    tenant_id: null,
    platform: decision.platform === 'all' ? null : decision.platform,
    decision_type: DECISION_TYPE_BY_REQUEST[decision.request_type],
    target_table: decision.target_table,
    target_id: decision.target_id,
    before_state: {
      source: 'ai_ad_director',
      evidence_refs: decision.evidence_refs,
    },
    after_state: decision.proposed_change,
    reason: decision.reason,
    confidence: decision.confidence,
    expected_impact: decision.expected_impact,
    applied: decision.can_auto_apply_l3,
    blocked_reason: decision.blocked_reasons[0] || null,
  };
}

function changeRequestRow(runId: string, decision: AdDirectorDecision) {
  const autoApproved = decision.can_auto_apply_l3 && !decision.blocked_reasons.length;
  return {
    tenant_id: null,
    decision_log_id: null,
    run_id: runId,
    platform: decision.platform === 'all' ? null : decision.platform,
    automation_level: 3,
    request_type: decision.request_type,
    target_table: decision.target_table,
    target_id: decision.target_id,
    status: autoApproved ? 'approved' : 'proposed',
    title: decision.title,
    reason: decision.reason,
    risk_level: decision.risk_level,
    expected_impact: decision.expected_impact,
    proposed_change: decision.proposed_change,
    rollback_payload: decision.rollback_payload,
    approval_required: !autoApproved,
    approved_at: autoApproved ? new Date().toISOString() : null,
  };
}

async function persistAiDirectorRun(run: AdDirectorRun) {
  if (!isSupabaseAdminConfigured) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to persist AI Director decisions.');
  }

  const { data: automationRun, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'analysis',
      mode: run.mode === 'guarded_l3' ? 'guarded' : 'dry_run',
      status: 'running',
      summary: {
        source: 'ai_ad_director',
        mode: run.mode,
        score_gate: run.score_gate,
        safety: run.safety,
      },
      errors: [],
    })
    .select('id')
    .single();

  if (runError || !automationRun) {
    throw new Error(runError?.message || 'AI Director run create failed.');
  }

  const runId = String(automationRun.id);
  try {
    const scoreRows = run.section_scores.map((section) => ({
      run_id: runId,
      tenant_id: null,
      section_key: section.section_key,
      section_label: section.section_label,
      score: section.score,
      status: section.status,
      blockers: section.blockers,
      recommendations: section.recommendations,
      evidence: {
        checks: section.checks,
        ...section.evidence,
      },
      generated_at: run.generated_at,
    }));
    const { error: scoreError } = await supabaseAdmin
      .from('ad_os_section_scores')
      .insert(scoreRows as never);
    if (scoreError) throw scoreError;

    const allocationRows = run.budget_allocations.map((allocation) => ({
      run_id: runId,
      tenant_id: null,
      platform: allocation.platform,
      allocation_pct: allocation.allocation_pct,
      monthly_cap_krw: allocation.monthly_cap_krw,
      daily_cap_krw: allocation.daily_cap_krw,
      max_cpc_krw: allocation.max_cpc_krw,
      status: allocation.status,
      rationale: allocation.rationale,
      guardrail_snapshot: allocation.guardrail_snapshot,
    }));
    const { error: allocationError } = await supabaseAdmin
      .from('ad_os_budget_allocations')
      .insert(allocationRows as never);
    if (allocationError) throw allocationError;

    const { error: decisionError } = await supabaseAdmin
      .from('ad_os_decision_logs')
      .insert(run.decisions.map((decision) => decisionLogRow(runId, decision)) as never);
    if (decisionError) throw decisionError;

    const { error: changeRequestError } = await supabaseAdmin
      .from('ad_os_change_requests')
      .insert(run.decisions.map((decision) => changeRequestRow(runId, decision)) as never);
    if (changeRequestError) throw changeRequestError;

    const packetRows = run.write_packets.map((packet) => ({
      run_id: runId,
      tenant_id: null,
      platform: packet.platform,
      packet_type: packet.packet_type,
      lifecycle_status: packet.lifecycle_status,
      idempotency_key: packet.idempotency_key,
      dry_run: packet.dry_run,
      external_api_write: packet.external_api_write,
      request_payload: packet.request_payload,
      guardrail_snapshot: packet.guardrail_snapshot,
      response_payload: {},
      blocked_reason: packet.blocked_reason,
      rollback_payload: packet.rollback_payload,
    }));
    const { error: packetError } = await supabaseAdmin
      .from('ad_os_platform_write_packets')
      .upsert(packetRows as never, { onConflict: 'platform,idempotency_key' });
    if (packetError) throw packetError;

    const persistenceSummary = {
      source: 'ai_ad_director',
      mode: run.mode,
      section_scores: scoreRows.length,
      budget_allocations: allocationRows.length,
      decisions: run.decisions.length,
      write_packets: packetRows.length,
      external_api_write: false,
      live_spend_krw: 0,
      score_gate: run.score_gate,
    };
    const { error: completeError } = await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        summary: persistenceSummary,
      })
      .eq('id', runId);
    if (completeError) throw completeError;

    return { run_id: runId, summary: persistenceSummary };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI Director persistence failed.';
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        errors: [{ message }],
      })
      .eq('id', runId);
    throw error;
  }
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = parseMode(body.mode);
    const apply = body.apply === true;
    const channels = parseChannels(body.channels);
    const [summary, sourceLedgerCount] = await withTimeout(
      Promise.all([fetchAdOsSummaryJson(request), getSourceLedgerCount()]),
      AI_DIRECTOR_TIMEOUT_MS,
      'ai director summary',
    );
    const run = buildAdDirectorRun({
      summary,
      mode,
      channels,
      sourceLedgerCount,
      apply,
    });

    if (!apply) {
      return NextResponse.json({
        ...run,
        persisted: false,
      });
    }

    const persistence = await persistAiDirectorRun(run);
    return NextResponse.json({
      ...run,
      persisted: true,
      persistence,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'blocked',
        error: error instanceof Error ? error.message : 'AI Director run failed.',
        safety: {
          read_only: true,
          database_mutation: false,
          external_api_write: false,
          live_spend_krw: 0,
          full_auto_allowed: false,
        },
      },
      { status: 500 },
    );
  }
});
