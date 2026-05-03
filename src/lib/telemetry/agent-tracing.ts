import { supabaseAdmin } from '@/lib/supabase';

export async function startTraceSpan(params: {
  traceId: string;
  spanName: string;
  sessionId?: string;
  taskId?: string;
  agentType?: string;
  metadata?: Record<string, unknown>;
}) {
  const { data, error } = await supabaseAdmin
    .from('agent_trace_spans')
    .insert({
      trace_id: params.traceId,
      span_name: params.spanName,
      session_id: params.sessionId ?? null,
      task_id: params.taskId ?? null,
      agent_type: params.agentType ?? null,
      metadata: params.metadata ?? {},
    })
    .select('id, started_at')
    .single();
  if (error) throw error;
  return data;
}

export async function endTraceSpan(params: {
  id: string;
  startedAt: string;
  metadata?: Record<string, unknown>;
}) {
  const started = new Date(params.startedAt).getTime();
  const endedAt = new Date();
  const duration = Number.isFinite(started) ? Math.max(0, endedAt.getTime() - started) : null;

  await supabaseAdmin
    .from('agent_trace_spans')
    .update({
      ended_at: endedAt.toISOString(),
      duration_ms: duration,
      ...(params.metadata ? { metadata: params.metadata } : {}),
    })
    .eq('id', params.id);
}

