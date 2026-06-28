import { NextRequest, NextResponse } from 'next/server';
import {
  buildMarketingDeepScorecard,
  type MarketingDeepRepairQueueItem,
  type MarketingDeepSubcategoryScore,
} from '@/lib/marketing-deep-scorecard';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { withTimeout } from '@/lib/promise-timeout';
import { fetchAdOsSummaryJson } from '../../_lib/summary-fetch';

export const dynamic = 'force-dynamic';

const REPAIR_PLAN_TIMEOUT_MS = 15000;

async function getReviewedSourceCount(): Promise<number> {
  if (!isSupabaseAdminConfigured) return 0;
  try {
    const { count, error } = await supabaseAdmin
      .from('ad_os_source_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'accepted');
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

function subcategoryRows(
  subcategories: MarketingDeepSubcategoryScore[],
  generatedAt: string,
) {
  return subcategories.map((item) => ({
    tenant_id: null,
    domain_key: item.domain_key,
    subcategory_id: item.id,
    label: item.label,
    score: item.score,
    target_score: item.target_score,
    post_repair_score: item.post_repair_score,
    status: item.status,
    priority: item.priority,
    weight: item.weight,
    critical: item.critical,
    owner: item.owner,
    automation_phase: item.automation_phase,
    blockers: item.blockers,
    evidence: item.evidence,
    source_refs: item.source_refs,
    repair_action: item.repair_action,
    generated_at: generatedAt,
  }));
}

function repairRows(items: MarketingDeepRepairQueueItem[], generatedAt: string) {
  return items.map((item) => ({
    repair_id: item.repair_id,
    tenant_id: null,
    domain_key: item.domain_key,
    subcategory_id: item.subcategory_id,
    title: item.title,
    current_score: item.current_score,
    target_score: item.target_score,
    expected_after_score: item.expected_after_score,
    priority: item.priority,
    owner: item.owner,
    automation_phase: item.automation_phase,
    action: item.action,
    evidence_refs: item.evidence_refs,
    can_stage_l3: item.can_stage_l3,
    approval_required: item.approval_required,
    blocked_reason: item.blocked_reason,
    status: 'proposed',
    safety: item.safety,
    generated_at: generatedAt,
    updated_at: generatedAt,
  }));
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}));
    const apply = body.apply === true;
    const [summary, sourceLedgerCount] = await withTimeout(
      Promise.all([fetchAdOsSummaryJson(request), getReviewedSourceCount()]),
      REPAIR_PLAN_TIMEOUT_MS,
      'marketing repair plan',
    );
    const scorecard = buildMarketingDeepScorecard({ summary, sourceLedgerCount });

    if (!apply) {
      return NextResponse.json({
        ok: true,
        preview: true,
        persisted: false,
        generated_at: scorecard.generated_at,
        score_gate: scorecard.score_gate,
        summary: scorecard.summary,
        repair_queue: scorecard.repair_queue,
        safety: scorecard.safety,
      });
    }

    if (!isSupabaseAdminConfigured) {
      return NextResponse.json(
        {
          ok: false,
          error: 'SUPABASE_SERVICE_ROLE_KEY is required to persist the repair queue.',
          safety: {
            read_only: true,
            database_mutation: false,
            external_api_write: false,
            live_spend_krw: 0,
          },
        },
        { status: 503 },
      );
    }

    const allSubcategories = scorecard.domains.flatMap((domain) => domain.subcategories);
    const { error: scoreError } = await supabaseAdmin
      .from('ad_os_subcategory_scores')
      .insert(subcategoryRows(allSubcategories, scorecard.generated_at) as never);
    if (scoreError) throw scoreError;

    const { error: queueError } = await supabaseAdmin
      .from('ad_os_repair_queue')
      .upsert(repairRows(scorecard.repair_queue, scorecard.generated_at) as never, { onConflict: 'repair_id' });
    if (queueError) throw queueError;

    return NextResponse.json({
      ok: true,
      preview: false,
      persisted: true,
      generated_at: scorecard.generated_at,
      persisted_rows: {
        subcategory_scores: allSubcategories.length,
        repair_queue: scorecard.repair_queue.length,
      },
      score_gate: scorecard.score_gate,
      summary: scorecard.summary,
      repair_queue: scorecard.repair_queue,
      safety: {
        read_only: false,
        database_mutation: true,
        external_api_write: false,
        live_spend_krw: 0,
        full_auto_allowed: false,
        provider_confirmation_required: true,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'blocked',
        error: error instanceof Error ? error.message : 'Marketing repair plan failed.',
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
