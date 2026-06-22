import { NextRequest, NextResponse } from 'next/server';
import { buildAdOsAgentOperatingModel } from '@/app/admin/ad-os/_lib/agent-operating-model';
import type { Summary } from '@/app/admin/ad-os/_lib/types';
import { withAdminGuard } from '@/lib/admin-guard';
import { persistAdOsCampaignMemory } from '@/lib/ad-os-campaign-memory';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type InternalStep = {
  key: string;
  url: string;
  body: Record<string, unknown>;
};

const DIAGNOSTIC_STEPS: InternalStep[] = [
  {
    key: 'learning_harvest',
    url: '/api/admin/ad-os/learning-harvest',
    body: { mode: 'guarded', apply: true, days: 30 },
  },
  {
    key: 'search_term_growth',
    url: '/api/admin/ad-os/search-term-growth',
    body: { apply: true, limit: 100, platforms: ['naver', 'google'] },
  },
  {
    key: 'performance_optimize',
    url: '/api/admin/ad-os/optimize-performance',
    body: { mode: 'dry_run', limit: 100 },
  },
  {
    key: 'budget_pacing',
    url: '/api/admin/ad-os/budget-pacing',
    body: { mode: 'dry_run' },
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  const json = await response.json().catch(() => ({}));
  return asRecord(json);
}

async function fetchSummary(request: NextRequest): Promise<Summary> {
  const url = new URL(request.url);
  const cookie = request.headers.get('cookie');
  const authorization = request.headers.get('authorization');
  const response = await fetch(`${url.origin}/api/admin/ad-os/summary`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    },
    cache: 'no-store',
  });
  const json = await parseJson(response);
  if (!response.ok || !json.ok) {
    throw new Error(String(json.error || 'Ad OS summary unavailable'));
  }
  return json as Summary;
}

async function runInternalStep(request: NextRequest, step: InternalStep) {
  const url = new URL(request.url);
  const cookie = request.headers.get('cookie');
  const authorization = request.headers.get('authorization');
  try {
    const response = await fetch(`${url.origin}${step.url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(step.body),
      cache: 'no-store',
    });
    const json = await parseJson(response);
    return {
      key: step.key,
      ok: response.ok && json.ok !== false,
      run_id: typeof json.run_id === 'string' ? json.run_id : null,
      summary: asRecord(json.summary),
      error: response.ok && json.ok !== false ? null : String(json.error || `${step.key} failed`),
    };
  } catch (error) {
    return {
      key: step.key,
      ok: false,
      run_id: null,
      summary: {},
      error: error instanceof Error ? error.message : `${step.key} failed`,
    };
  }
}

async function createDiagnosticRun(tenantId: string | null, runPipeline: boolean) {
  const { data, error } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      tenant_id: tenantId,
      run_type: 'analysis',
      mode: 'dry_run',
      status: 'running',
      summary: {
        kind: 'ai_ad_team_roas_diagnostic',
        run_pipeline: runPipeline,
        external_api_write: false,
      },
    })
    .select('id')
    .single();
  if (error || !data) throw error || new Error('Diagnostic run create failed');
  return data.id as string;
}

async function completeDiagnosticRun(
  runId: string,
  status: 'completed' | 'failed',
  summary: Record<string, unknown>,
  errors: Array<Record<string, unknown>> = [],
) {
  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      summary,
      errors,
    })
    .eq('id', runId);
}

async function insertDiagnosticDecisions(input: {
  runId: string;
  tenantId: string | null;
  memoryId: string;
  model: ReturnType<typeof buildAdOsAgentOperatingModel>;
}) {
  const rows = input.model.roasDiagnostic.hypotheses.map((hypothesis) => ({
    run_id: input.runId,
    tenant_id: input.tenantId,
    platform: null,
    decision_type: 'no_change',
    target_table: 'ad_os_campaign_memories',
    target_id: input.memoryId,
    before_state: {},
    after_state: {
      hypothesis_id: hypothesis.id,
      priority: hypothesis.priority,
      needs_human_approval: hypothesis.needsHumanApproval,
    },
    reason: hypothesis.reason,
    confidence: hypothesis.priority === 'high' ? 0.84 : hypothesis.priority === 'medium' ? 0.72 : 0.6,
    expected_impact: {
      source: 'ai_ad_team_roas_diagnostic',
      evidence: hypothesis.evidence,
      immediate_action: hypothesis.immediateAction,
      hold_reason: hypothesis.holdReason,
    },
    applied: false,
    blocked_reason: hypothesis.needsHumanApproval ? 'human_approval_required' : hypothesis.holdReason,
  }));
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin.from('ad_os_decision_logs').insert(rows as never);
  if (error) throw error;
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id : null;
  const runPipeline = body.run_pipeline !== false;
  const persistMemory = body.persist_memory !== false;
  let runId: string | null = null;

  try {
    runId = await createDiagnosticRun(tenantId, runPipeline);
    const pipelineResults = runPipeline
      ? await Promise.all(DIAGNOSTIC_STEPS.map((step) => runInternalStep(request, step)))
      : [];
    const summary = await fetchSummary(request);
    const model = buildAdOsAgentOperatingModel(summary);

    const memory = persistMemory
      ? await persistAdOsCampaignMemory(supabaseAdmin, {
          tenantId,
          model,
          summary,
          diagnostic: {
            run_id: runId,
            run_pipeline: runPipeline,
            generated_at: new Date().toISOString(),
          },
          pipelineResults,
        })
      : null;

    if (memory) {
      await insertDiagnosticDecisions({
        runId,
        tenantId,
        memoryId: memory.id,
        model,
      });
    }

    const failedSteps = pipelineResults.filter((step) => !step.ok);
    const resultSummary = {
      kind: 'ai_ad_team_roas_diagnostic',
      run_pipeline: runPipeline,
      pipeline_steps: pipelineResults.length,
      failed_steps: failedSteps.length,
      memory_id: memory?.id || null,
      memory_created: memory?.created || false,
      roas_score: model.roasDiagnostic.score,
      team_score: model.teamScore,
      external_api_write: false,
    };
    await completeDiagnosticRun(runId, 'completed', resultSummary, failedSteps.map((step) => ({
      step: step.key,
      message: step.error,
    })));

    return NextResponse.json({
      ok: true,
      run_id: runId,
      memory_id: memory?.id || null,
      memory_created: memory?.created || false,
      pipeline_results: pipelineResults,
      model,
      summary: resultSummary,
    });
  } catch (error) {
    const safeError = sanitizeDbError(error, 'AI 광고팀 진단에 실패했습니다');
    if (runId) {
      await completeDiagnosticRun(runId, 'failed', {
        kind: 'ai_ad_team_roas_diagnostic',
        error: safeError,
        external_api_write: false,
      }, [{ message: safeError }]);
    }
    return NextResponse.json({ ok: false, error: safeError }, { status: 500 });
  }
});
