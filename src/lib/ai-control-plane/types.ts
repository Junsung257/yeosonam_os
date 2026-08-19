export type AiProvider = 'deepseek';
export type AiModelClass = 'flash' | 'pro';
export type AiReservationStatus = 'reserved' | 'completed' | 'failed' | 'expired';

export interface AiUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface AiProviderResult<T = unknown> {
  value: T;
  provider: AiProvider;
  model: string;
  finishReason: string | null;
  usage?: AiUsage | null;
  providerRequestId?: string | null;
  responseHash?: string | null;
}

export interface AiCallReceipt {
  reservationId: string;
  rootJobId: string;
  candidateId: string;
  workload: string;
  task: string;
  stage: string;
  provider: AiProvider;
  model: string;
  success: boolean;
  finishReason: string | null;
  usage: AiUsage | null;
  actualCostUsd: number | null;
  latencyMs: number;
  providerRequestId: string | null;
  responseHash: string | null;
  errorCode: string | null;
  idempotencyKey: string;
  promptHash: string;
}

export interface AiBudgetReservation {
  reservationId: string;
  allowed: boolean;
  reason: string;
  requestedUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  duplicate: boolean;
}

export interface AiBudgetRepository {
  reserve(input: {
    rootJobId: string;
    candidateId: string;
    workload: string;
    task: string;
    stage: string;
    provider: AiProvider;
    model: string;
    modelClass: AiModelClass;
    idempotencyKey: string;
    promptHash: string;
    estimatedInputTokens: number;
    maxOutputTokens: number;
    requestedUsd: number;
  }): Promise<AiBudgetReservation>;
  settle(input: {
    reservationId: string;
    success: boolean;
    finishReason: string | null;
    usage: AiUsage | null;
    actualCostUsd: number | null;
    latencyMs: number;
    providerRequestId: string | null;
    responseHash: string | null;
    errorCode: string | null;
    idempotencyKey: string;
  }): Promise<void>;
}

export class AiControlPlaneError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'task_not_registered'
      | 'provider_not_allowed'
      | 'budget_blocked'
      | 'budget_unavailable'
      | 'duplicate_call'
      | 'provider_contract_violation'
      | 'receipt_settlement_failed'
      | 'provider_failed',
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AiControlPlaneError';
  }
}
