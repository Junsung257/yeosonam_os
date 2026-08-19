import { supabaseAdmin } from '@/lib/supabase';
import { AiControlPlaneError, type AiBudgetRepository, type AiBudgetReservation, type AiProvider, type AiUsage } from './types';

function rowToReservation(row: Record<string, unknown>): AiBudgetReservation {
  return {
    reservationId: typeof row.reservation_id === 'string' ? row.reservation_id : '',
    allowed: row.allowed === true,
    reason: typeof row.reason === 'string' ? row.reason : 'budget_blocked',
    requestedUsd: Number(row.requested_usd ?? 0),
    reservedUsd: Number(row.reserved_usd ?? 0),
    remainingUsd: Number(row.remaining_usd ?? 0),
    duplicate: row.reason === 'duplicate_inflight'
      || row.reason === 'duplicate_completed'
      || row.reason === 'duplicate_prompt',
  };
}

export const supabaseAiBudgetRepository: AiBudgetRepository = {
  async reserve(input) {
    const { data, error } = await supabaseAdmin.rpc('reserve_ai_budget_v1', {
      p_root_job_id: input.rootJobId,
      p_candidate_id: input.candidateId,
      p_workload: input.workload,
      p_task: input.task,
      p_stage: input.stage,
      p_provider: input.provider,
      p_model: input.model,
      p_model_class: input.modelClass,
      p_idempotency_key: input.idempotencyKey,
      p_prompt_hash: input.promptHash,
      p_estimated_input_tokens: input.estimatedInputTokens,
      p_max_output_tokens: input.maxOutputTokens,
      p_requested_usd: input.requestedUsd,
    }).maybeSingle();
    if (error || !data) {
      throw new AiControlPlaneError(
        `ai_budget_reservation_unavailable:${error?.message ?? 'empty_response'}`,
        'budget_unavailable',
      );
    }
    const reservation = rowToReservation(data as Record<string, unknown>);
    if (reservation.duplicate) {
      throw new AiControlPlaneError(`ai_duplicate_call:${reservation.reason}`, 'duplicate_call');
    }
    if (!reservation.allowed || !reservation.reservationId) {
      throw new AiControlPlaneError(`ai_budget_blocked:${reservation.reason}`, 'budget_blocked');
    }
    return reservation;
  },
  async settle(input) {
    const { error } = await supabaseAdmin.rpc('settle_ai_budget_v1', {
      p_reservation_id: input.reservationId,
      p_success: input.success,
      p_finish_reason: input.finishReason,
      p_input_tokens: input.usage?.inputTokens ?? null,
      p_cached_input_tokens: input.usage?.cachedInputTokens ?? null,
      p_output_tokens: input.usage?.outputTokens ?? null,
      p_actual_cost_usd: input.actualCostUsd,
      p_latency_ms: input.latencyMs,
      p_provider_request_id: input.providerRequestId,
      p_response_hash: input.responseHash,
      p_trace_id: input.traceId,
      p_error_code: input.errorCode,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw new AiControlPlaneError(`ai_receipt_settlement_failed:${error.message}`, 'receipt_settlement_failed');
  },
};

export function createInMemoryAiBudgetRepository(options?: {
  dailyCapUsd?: number;
  candidateCapUsd?: number;
  proDailyCallCap?: number;
}): AiBudgetRepository & { receipts: Array<Record<string, unknown>> } {
  const dailyCap = options?.dailyCapUsd ?? 1.5;
  const candidateCap = options?.candidateCapUsd ?? 0.08;
  const proDailyCallCap = options?.proDailyCallCap ?? 10;
  const reservations = new Map<string, { id: string; request: Parameters<AiBudgetRepository['reserve']>[0]; status: string }>();
  const receipts: Array<Record<string, unknown>> = [];
  let reserved = 0;
  return {
    receipts,
    async reserve(input) {
      const duplicate = reservations.get(input.idempotencyKey);
      if (duplicate) throw new AiControlPlaneError('ai_duplicate_call', 'duplicate_call');
      const duplicatePrompt = [...reservations.values()].find((item) => (
        item.request.candidateId === input.candidateId
        && item.request.promptHash === input.promptHash
        && ['reserved', 'completed', 'failed'].includes(item.status)
      ));
      if (duplicatePrompt) throw new AiControlPlaneError('ai_duplicate_prompt', 'duplicate_call');
      const proCalls = [...reservations.values()].filter((item) => (
        item.request.modelClass === 'pro' && ['reserved', 'completed', 'failed'].includes(item.status)
      )).length;
      if (input.modelClass === 'pro' && proCalls >= proDailyCallCap) {
        throw new AiControlPlaneError('ai_budget_blocked:pro_daily_call_cap', 'budget_blocked');
      }
      const candidateModelCalls = [...reservations.values()].filter((item) => (
        item.request.candidateId === input.candidateId
        && item.request.modelClass === input.modelClass
        && ['reserved', 'completed', 'failed'].includes(item.status)
      )).length;
      if (candidateModelCalls >= 1) {
        throw new AiControlPlaneError('ai_budget_blocked:candidate_model_call_cap', 'budget_blocked');
      }
      if (input.requestedUsd > candidateCap) throw new AiControlPlaneError('ai_budget_blocked:candidate_cap', 'budget_blocked');
      if (reserved + input.requestedUsd > dailyCap) throw new AiControlPlaneError('ai_budget_blocked:daily_cap', 'budget_blocked');
      const id = `memory-${reservations.size + 1}`;
      reservations.set(input.idempotencyKey, { id, request: input, status: 'reserved' });
      reserved += input.requestedUsd;
      return { reservationId: id, allowed: true, reason: 'reserved', requestedUsd: input.requestedUsd, reservedUsd: input.requestedUsd, remainingUsd: dailyCap - reserved, duplicate: false };
    },
    async settle(input) {
      const row = [...reservations.values()].find((item) => item.id === input.reservationId);
      if (!row) throw new AiControlPlaneError('unknown_ai_reservation', 'receipt_settlement_failed');
      row.status = input.success ? 'completed' : 'failed';
      receipts.push({ ...input, traceId: input.traceId });
    },
  };
}
