import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { requirePlatformAdminRequest } from '@/lib/admin-guard';
import {
  buildAgentOfficeSnapshot,
  type AgentOfficeApprovalRow,
  type AgentOfficeIncidentRow,
  type AgentOfficeTaskRow,
  type AgentOfficeTraceRow,
} from '@/lib/agent-office';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TASK_LIMIT = 240;
const APPROVAL_LIMIT = 240;
const INCIDENT_LIMIT = 160;
const TRACE_LIMIT = 320;

async function getHandler(_request: NextRequest) {
  const generatedAt = new Date().toISOString();

  if (!isSupabaseConfigured) {
    const response = apiResponse(buildAgentOfficeSnapshot({
      generatedAt,
      tasks: [],
      approvals: [],
      incidents: [],
      traces: [],
      sourceIssues: ['Supabase 미설정으로 운영 원장을 읽을 수 없습니다.'],
    }));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  try {
    const [taskResult, approvalResult, incidentResult, traceResult] = await Promise.all([
      supabaseAdmin
        .from('agent_tasks')
        .select([
          'id',
          'correlation_id',
          'source',
          'agent_type',
          'specialist_id',
          'risk_level',
          'status',
          'retry_count',
          'max_retries',
          'last_error',
          'assigned_to',
          'started_at',
          'completed_at',
          'created_at',
          'updated_at',
          'task_context',
        ].join(', '))
        .order('updated_at', { ascending: false })
        .limit(TASK_LIMIT),
      supabaseAdmin
        .from('agent_approvals')
        .select([
          'id',
          'task_id',
          'status',
          'reason',
          'requested_by',
          'reviewed_by',
          'requested_at',
          'reviewed_at',
          'expires_at',
        ].join(', '))
        .order('requested_at', { ascending: false })
        .limit(APPROVAL_LIMIT),
      supabaseAdmin
        .from('agent_incidents')
        .select([
          'id',
          'correlation_id',
          'task_id',
          'severity',
          'category',
          'message',
          'detected_by',
          'created_at',
        ].join(', '))
        .order('created_at', { ascending: false })
        .limit(INCIDENT_LIMIT),
      supabaseAdmin
        .from('agent_trace_spans')
        .select([
          'id',
          'trace_id',
          'task_id',
          'span_name',
          'agent_type',
          'started_at',
          'ended_at',
          'duration_ms',
        ].join(', '))
        .order('started_at', { ascending: false })
        .limit(TRACE_LIMIT),
    ]);

    if (taskResult.error) throw taskResult.error;

    const sourceIssues: string[] = [];
    if (approvalResult.error) {
      console.error('[agent-office] approval source unavailable', approvalResult.error);
      sourceIssues.push('승인 원장을 읽지 못해 승인 수치가 부분 집계됐습니다.');
    }
    if (incidentResult.error) {
      console.error('[agent-office] incident source unavailable', incidentResult.error);
      sourceIssues.push('사고 원장을 읽지 못해 사고 수치가 부분 집계됐습니다.');
    }
    if (traceResult.error) {
      console.error('[agent-office] trace source unavailable', traceResult.error);
      sourceIssues.push('추적 원장을 읽지 못해 실행 시간과 타임라인이 부분 집계됐습니다.');
    }

    const snapshot = buildAgentOfficeSnapshot({
      generatedAt,
      tasks: (taskResult.data ?? []) as unknown as AgentOfficeTaskRow[],
      approvals: approvalResult.error
        ? []
        : (approvalResult.data ?? []) as unknown as AgentOfficeApprovalRow[],
      incidents: incidentResult.error
        ? []
        : (incidentResult.data ?? []) as unknown as AgentOfficeIncidentRow[],
      traces: traceResult.error
        ? []
        : (traceResult.data ?? []) as unknown as AgentOfficeTraceRow[],
      sourceIssues,
    });

    const response = apiResponse(snapshot);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('[agent-office] snapshot failed', error);
    return apiResponse(
      { error: sanitizeDbError(error, 'AI 운영실 스냅샷 조회 실패') },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export const GET = async (request: NextRequest) => {
  const authError = await requirePlatformAdminRequest(request);
  if (authError) return authError;
  return getHandler(request);
};
