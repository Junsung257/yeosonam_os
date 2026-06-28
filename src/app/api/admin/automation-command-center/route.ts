import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseAdminConfigured, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { withTimeout } from '@/lib/promise-timeout';
import { evaluateCustomerInquiryReadiness } from '@/lib/jarvis/eval/customer-inquiry-readiness';
import { evaluateJarvisGoldenSet } from '@/lib/jarvis/eval/offline-evaluator';
import { evaluateRagGoldenSet } from '@/lib/jarvis/eval/rag-evaluator';
import { auditRagIndexRows, type RagIndexAuditRow } from '@/lib/jarvis/eval/rag-index-audit';
import { evaluateJarvisReadiness } from '@/lib/jarvis/eval/readiness-gate';
import { TRACE_GOLDEN_CASES } from '@/lib/jarvis/eval/trace-golden-cases';
import { gradeJarvisTraceSet } from '@/lib/jarvis/eval/trace-grader';
import { evaluateAllScenarioReadiness } from '@/lib/jarvis/eval/all-scenarios-readiness';
import { evaluateFreeTravel100Scenarios } from '@/lib/free-travel/eval/scenario-evaluator';
import {
  buildMarketingDeepScorecard,
  buildMarketingReadyFixtureSummary,
  MARKETING_DEEP_SOURCE_TARGET,
} from '@/lib/marketing-deep-scorecard';
import {
  buildAutomationCommandCenterSnapshot,
  type AutomationCommandCenterTopPacket,
} from '@/lib/automation-command-center';
import { fetchAdOsSummaryJson } from '../ad-os/_lib/summary-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMAND_CENTER_TIMEOUT_MS = 18000;

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

async function buildJarvisScenarioSummary() {
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

  return evaluateAllScenarioReadiness({
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
}

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

async function buildAdOsScorecards(request: NextRequest) {
  const [summary, sourceLedgerCount] = await Promise.all([
    fetchAdOsSummaryJson(request),
    getReviewedSourceCount(),
  ]);

  return {
    current: buildMarketingDeepScorecard({ summary, sourceLedgerCount }),
    readyFixture: buildMarketingDeepScorecard({
      summary: buildMarketingReadyFixtureSummary(),
      sourceLedgerCount: MARKETING_DEEP_SOURCE_TARGET,
    }),
  };
}

async function loadApprovalQueue(): Promise<{
  pending_count: number;
  high_risk_count: number;
  top_packets: AutomationCommandCenterTopPacket[];
  unavailable_reason?: string | null;
}> {
  if (!isSupabaseConfigured) {
    return {
      pending_count: 0,
      high_risk_count: 0,
      top_packets: [],
      unavailable_reason: 'Supabase is not configured; approval queue evidence is unavailable.',
    };
  }

  try {
    const [pendingRes, highRiskRes] = await Promise.all([
      supabaseAdmin
        .from('agent_actions')
        .select('id, agent_type, action_type, summary, priority, status, created_at', { count: 'exact' })
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('agent_actions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .in('priority', ['high', 'critical']),
    ]);

    const firstError = pendingRes.error ?? highRiskRes.error;
    if (firstError) throw firstError;

    return {
      pending_count: pendingRes.count ?? pendingRes.data?.length ?? 0,
      high_risk_count: highRiskRes.count ?? 0,
      top_packets: (pendingRes.data ?? []).map((row) => ({
        id: String(row.id),
        agent_type: String(row.agent_type || 'unknown'),
        action_type: String(row.action_type || 'unknown'),
        summary: String(row.summary || ''),
        priority: String(row.priority || 'normal'),
        status: String(row.status || 'pending'),
        created_at: typeof row.created_at === 'string' ? row.created_at : null,
      })),
    };
  } catch (error) {
    return {
      pending_count: 0,
      high_risk_count: 0,
      top_packets: [],
      unavailable_reason: sanitizeDbError(error, 'Approval queue evidence is unavailable.'),
    };
  }
}

async function getHandler(request: NextRequest) {
  const generatedAt = new Date().toISOString();

  const snapshot = await withTimeout(
    Promise.allSettled([
      buildJarvisScenarioSummary(),
      buildAdOsScorecards(request),
      loadApprovalQueue(),
    ]).then(([jarvisResult, adOsResult, approvalResult]) => {
      const adOsScorecards = adOsResult.status === 'fulfilled'
        ? adOsResult.value
        : {
            current: null,
            readyFixture: buildMarketingDeepScorecard({
              summary: buildMarketingReadyFixtureSummary(),
              sourceLedgerCount: MARKETING_DEEP_SOURCE_TARGET,
            }),
          };

      const approvalQueue = approvalResult.status === 'fulfilled'
        ? approvalResult.value
        : {
            pending_count: 0,
            high_risk_count: 0,
            top_packets: [],
            unavailable_reason: approvalResult.reason instanceof Error
              ? approvalResult.reason.message
              : 'Approval queue evidence is unavailable.',
          };

      return buildAutomationCommandCenterSnapshot({
        generatedAt,
        jarvisSummary: jarvisResult.status === 'fulfilled' ? jarvisResult.value : null,
        adOsCurrentScorecard: adOsScorecards.current,
        adOsReadyFixtureScorecard: adOsScorecards.readyFixture,
        approvalQueue,
      });
    }),
    COMMAND_CENTER_TIMEOUT_MS,
    'automation command center',
  );

  const response = apiResponse(snapshot);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const GET = withAdminGuard(getHandler);
