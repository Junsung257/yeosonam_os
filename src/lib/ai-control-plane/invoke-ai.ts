import { assertRegisteredAiTask } from './task-registry';
import { estimateAiCostUsd, calculateSettledAiCostUsd } from './pricing';
import { assertDeterministicIdempotencyKey, hashResponse } from './idempotency';
import { runSingleProviderCall } from './retry-policy';
import { supabaseAiBudgetRepository } from './budget-firewall';
import { AiControlPlaneError, type AiBudgetRepository, type AiCallReceipt, type AiProviderResult } from './types';
import type { AiProviderExecutor } from './provider-client';

export interface InvokeAiInput<T> {
  workload: 'blog-production';
  task: 'informational-draft' | 'targeted-repair' | 'targeted-repair-max';
  rootJobId: string;
  candidateId: string;
  stage: string;
  model: string;
  idempotencyKey: string;
  promptHash: string;
  estimatedMaxInputTokens: number;
  maxOutputTokens: number;
  execute: AiProviderExecutor<T>;
  budgetRepository?: AiBudgetRepository;
}

export async function invokeAi<T>(input: InvokeAiInput<T>): Promise<{ value: T; receipt: AiCallReceipt }> {
  const policy = assertRegisteredAiTask(input.workload, input.task);
  if (policy.provider !== 'deepseek' || !input.model.startsWith('deepseek-')) {
    throw new AiControlPlaneError(`provider_not_allowed:${input.model}`, 'provider_not_allowed');
  }
  const idempotencyKey = assertDeterministicIdempotencyKey(input.idempotencyKey);
  const repository = input.budgetRepository ?? supabaseAiBudgetRepository;
  const requestedUsd = estimateAiCostUsd({
    modelClass: policy.modelClass,
    estimatedInputTokens: input.estimatedMaxInputTokens,
    maxOutputTokens: input.maxOutputTokens,
  });
  const reservation = await repository.reserve({
    rootJobId: input.rootJobId,
    candidateId: input.candidateId,
    workload: input.workload,
    task: input.task,
    stage: input.stage,
    provider: policy.provider,
    model: input.model,
    modelClass: policy.modelClass,
    idempotencyKey,
    promptHash: input.promptHash,
    estimatedInputTokens: input.estimatedMaxInputTokens,
    maxOutputTokens: input.maxOutputTokens,
    requestedUsd,
  });
  const startedAt = Date.now();
  try {
    const result = await runSingleProviderCall<AiProviderResult<T>>({
      maxProviderCalls: policy.maxProviderCalls,
      execute: input.execute,
    });
    if (result.provider !== policy.provider || result.model !== input.model) {
      throw new AiControlPlaneError(
        `provider_result_mismatch:${result.provider}/${result.model}`,
        'provider_contract_violation',
      );
    }
    const usage = result.usage ?? null;
    const actualCostUsd = usage ? calculateSettledAiCostUsd({ modelClass: policy.modelClass, usage }) : null;
    const receipt: AiCallReceipt = {
      reservationId: reservation.reservationId,
      rootJobId: input.rootJobId,
      candidateId: input.candidateId,
      workload: input.workload,
      task: input.task,
      stage: input.stage,
      provider: result.provider,
      model: result.model,
      success: true,
      finishReason: result.finishReason,
      usage,
      actualCostUsd,
      latencyMs: Math.max(0, Date.now() - startedAt),
      providerRequestId: result.providerRequestId ?? null,
      responseHash: result.responseHash ?? hashResponse(result.value),
      errorCode: null,
      idempotencyKey,
      promptHash: input.promptHash,
    };
    await repository.settle({
      reservationId: receipt.reservationId,
      success: true,
      finishReason: receipt.finishReason,
      usage: receipt.usage,
      actualCostUsd: receipt.actualCostUsd,
      latencyMs: receipt.latencyMs,
      providerRequestId: receipt.providerRequestId,
      responseHash: receipt.responseHash,
      errorCode: null,
      idempotencyKey,
    });
    return { value: result.value, receipt };
  } catch (error) {
    const controlError = error instanceof AiControlPlaneError ? error : new AiControlPlaneError(
      error instanceof Error ? error.message : String(error),
      'provider_failed',
    );
    try {
      await repository.settle({
        reservationId: reservation.reservationId,
        success: false,
        finishReason: null,
        usage: null,
        actualCostUsd: null,
        latencyMs: Math.max(0, Date.now() - startedAt),
        providerRequestId: null,
        responseHash: null,
        errorCode: controlError.code,
        idempotencyKey,
      });
    } catch (settlementError) {
      throw new AiControlPlaneError(
        `${controlError.message};${settlementError instanceof Error ? settlementError.message : String(settlementError)}`,
        'receipt_settlement_failed',
        controlError.retryable,
      );
    }
    throw controlError;
  }
}
