import {
  calculateSettledAiCostUsd,
  estimateAiCostUsd,
  supabaseAiBudgetRepository,
  type AiBudgetReservation,
  type AiUsage,
} from '@/lib/ai-control-plane';
import type { BlogAiUsageReceipt } from '@/lib/blog-ai-caller';
import type { BlogDeepSeekStage } from '@/lib/blog-deepseek-orchestrator-v4';
import { createHash } from 'node:crypto';

export function isBlogAiControlPlaneEnabled(): boolean {
  return process.env.BLOG_AI_CONTROL_PLANE_ENABLED === '1';
}

function taskForStage(stage: BlogDeepSeekStage): 'informational-draft' | 'targeted-repair' | 'targeted-repair-max' {
  if (stage === 'draft_flash') return 'informational-draft';
  return stage === 'rewrite_pro_max' ? 'targeted-repair-max' : 'targeted-repair';
}

export async function reserveBlogAiControlPlaneV4(input: {
  queueId: string;
  attemptNumber: number;
  stage: BlogDeepSeekStage;
  provider: 'deepseek';
  model: string;
  prompt: string;
  maxOutputTokens: number;
}): Promise<AiBudgetReservation> {
  const task = taskForStage(input.stage);
  const modelClass = input.stage === 'draft_flash' ? 'flash' : 'pro';
  const promptHash = createHash('sha256').update(input.prompt).digest('hex');
  return supabaseAiBudgetRepository.reserve({
    rootJobId: `blog:${input.queueId}`,
    candidateId: input.queueId,
    workload: 'blog-production',
    task,
    stage: input.stage,
    provider: input.provider,
    model: input.model,
    modelClass,
    idempotencyKey: `blog-production:${input.queueId}:${input.stage}:${input.attemptNumber}`,
    promptHash,
    // Provider prompts can be large, but a 16k bound keeps the first canary
    // conservative while avoiding a reservation larger than the candidate cap.
    estimatedInputTokens: 16_384,
    maxOutputTokens: input.maxOutputTokens,
    requestedUsd: estimateAiCostUsd({
      modelClass,
      estimatedInputTokens: 16_384,
      maxOutputTokens: input.maxOutputTokens,
    }),
  });
}

export async function settleBlogAiControlPlaneV4(input: {
  reservationId: string;
  queueId: string;
  attemptNumber: number;
  stage: BlogDeepSeekStage;
  prompt: string;
  receipt: BlogAiUsageReceipt | null;
  success: boolean;
  errorCode?: string | null;
}): Promise<void> {
  const usage: AiUsage | null = input.receipt?.usage
    ? {
      inputTokens: input.receipt.usage.inputTokens,
      cachedInputTokens: input.receipt.usage.cachedInputTokens,
      outputTokens: input.receipt.usage.outputTokens,
    }
    : input.receipt?.deepseekCost
      ? {
        inputTokens: input.receipt.deepseekCost.inputTokens,
        cachedInputTokens: input.receipt.deepseekCost.cacheHitInputTokens,
        outputTokens: input.receipt.deepseekCost.outputTokens,
      }
      : null;
  const modelClass = input.stage === 'draft_flash' ? 'flash' : 'pro';
  const actualCostUsd = usage
    ? calculateSettledAiCostUsd({ modelClass, usage })
    : null;
  await supabaseAiBudgetRepository.settle({
    reservationId: input.reservationId,
    success: input.success,
    finishReason: input.receipt?.finishReason ?? null,
    usage,
    actualCostUsd,
    latencyMs: input.receipt?.latencyMs ?? 0,
    providerRequestId: null,
    responseHash: null,
    errorCode: input.errorCode ?? null,
    idempotencyKey: `blog-production:${input.queueId}:${input.stage}:${input.attemptNumber}`,
  });
}
