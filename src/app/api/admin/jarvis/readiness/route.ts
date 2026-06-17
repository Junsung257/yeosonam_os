import { type NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { evaluateJarvisGoldenSet } from '@/lib/jarvis/eval/offline-evaluator';
import { evaluateRagGoldenSet } from '@/lib/jarvis/eval/rag-evaluator';
import { TRACE_GOLDEN_CASES } from '@/lib/jarvis/eval/trace-golden-cases';
import { gradeJarvisTraceSet } from '@/lib/jarvis/eval/trace-grader';
import { auditRagIndexRows, type RagIndexAuditRow } from '@/lib/jarvis/eval/rag-index-audit';
import { evaluateJarvisReadiness } from '@/lib/jarvis/eval/readiness-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadLiveRagAudit() {
  if (!isSupabaseConfigured) {
    return { skipped: true, totalRows: null, audit: null };
  }

  const [totalRes, sampleRes] = await Promise.all([
    supabaseAdmin.from('jarvis_knowledge_chunks').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('jarvis_knowledge_chunks')
      .select([
        'id',
        'tenant_id',
        'source_type',
        'source_id',
        'source_url',
        'source_title',
        'chunk_index',
        'chunk_text',
        'contextual_text',
        'content_hash',
        'updated_at',
      ].join(', '))
      .order('updated_at', { ascending: false })
      .limit(250),
  ]);

  const firstError = totalRes.error ?? sampleRes.error;
  if (firstError) throw firstError;

  return {
    skipped: false,
    totalRows: totalRes.count ?? 0,
    audit: auditRagIndexRows((sampleRes.data ?? []) as unknown as RagIndexAuditRow[]),
  };
}

const getHandler = async (): Promise<NextResponse> => {
  try {
    const deterministic = evaluateJarvisGoldenSet();
    const rag = evaluateRagGoldenSet();
    const trace = gradeJarvisTraceSet(TRACE_GOLDEN_CASES);
    const liveRag = await loadLiveRagAudit();
    const summary = evaluateJarvisReadiness({
      deterministicPassRate: deterministic.passRate,
      ragPassRate: rag.passRate,
      tracePassRate: trace.passRate,
      traceAverageScore: trace.averageScore,
      liveRagScore: liveRag.audit?.qualityScore ?? null,
      liveRagReadiness: liveRag.audit?.readinessLevel ?? 'skipped',
      liveRagSearchPassed: 'skipped',
      smokePassed: 'skipped',
      typecheckPassed: 'skipped',
      componentTestsPassed: 'skipped',
    });

    return apiResponse({
      mode: 'lightweight',
      generated_at: new Date().toISOString(),
      release_gate_command: 'npm run verify:jarvis-readiness:ci',
      summary,
      live_rag: liveRag,
    });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, 'Failed to load Jarvis readiness') },
      { status: 500 },
    );
  }
};

export const GET = withAdminGuard(getHandler);
