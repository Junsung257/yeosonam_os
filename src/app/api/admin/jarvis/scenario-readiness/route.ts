import { type NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { evaluateCustomerInquiryReadiness } from '@/lib/jarvis/eval/customer-inquiry-readiness';
import { evaluateJarvisGoldenSet } from '@/lib/jarvis/eval/offline-evaluator';
import { evaluateRagGoldenSet } from '@/lib/jarvis/eval/rag-evaluator';
import { auditRagIndexRows, type RagIndexAuditRow } from '@/lib/jarvis/eval/rag-index-audit';
import { evaluateJarvisReadiness } from '@/lib/jarvis/eval/readiness-gate';
import { TRACE_GOLDEN_CASES } from '@/lib/jarvis/eval/trace-golden-cases';
import { gradeJarvisTraceSet } from '@/lib/jarvis/eval/trace-grader';
import { evaluateAllScenarioReadiness } from '@/lib/jarvis/eval/all-scenarios-readiness';
import { evaluateFreeTravel100Scenarios } from '@/lib/free-travel/eval/scenario-evaluator';

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
    const jarvisReadiness = evaluateJarvisReadiness({
      deterministicPassRate: deterministic.passRate,
      ragPassRate: rag.passRate,
      tracePassRate: trace.passRate,
      traceAverageScore: trace.averageScore,
      liveRagScore: liveRag.audit?.qualityScore ?? null,
      liveRagReadiness: liveRag.audit?.readinessLevel ?? 'skipped',
      smokePassed: 'skipped',
      typecheckPassed: 'skipped',
      componentTestsPassed: 'skipped',
    });
    const customerInquiry = evaluateCustomerInquiryReadiness();
    const freeTravel = evaluateFreeTravel100Scenarios();
    const summary = evaluateAllScenarioReadiness({
      jarvisReadinessScore: jarvisReadiness.score,
      jarvisReadinessMaxScore: jarvisReadiness.maxScore,
      jarvisReadinessStatus: jarvisReadiness.status,
      customerInquiryScore: customerInquiry.score,
      customerInquiryStatus: customerInquiry.status,
      autopilotHitlPassed: 'skipped',
      freeTravelScore: freeTravel.score,
      freeTravelStatus: freeTravel.status,
      freeTravelP0Failures: freeTravel.p0Failures.length,
      liveRagScore: liveRag.audit?.qualityScore ?? null,
      liveRagReadiness: liveRag.audit?.readinessLevel ?? 'skipped',
    });
    const response = apiResponse({
      mode: 'lightweight',
      generated_at: new Date().toISOString(),
      release_gate_command: 'npm run verify:jarvis-all-scenarios -- --json',
      summary,
      jarvis_readiness: jarvisReadiness,
      customer_inquiry: customerInquiry,
      free_travel: freeTravel,
      live_rag: liveRag,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (err) {
    const response = apiResponse(
      { error: sanitizeDbError(err, 'Failed to load Jarvis scenario readiness') },
      { status: 500 },
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
};

export const GET = withAdminGuard(getHandler);
