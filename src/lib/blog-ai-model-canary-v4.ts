import type { BlogAiUsageReceipt } from './blog-ai-caller';
import {
  resolveBlogGenerationModelV4,
  type BlogDeepSeekStage,
} from './blog-deepseek-orchestrator-v4';

export const BLOG_AI_MODEL_CANARY_STAGES_V4: readonly BlogDeepSeekStage[] = [
  'draft_flash',
  'rewrite_pro_high',
  'rewrite_pro_max',
  'rescue_gemini',
] as const;

export type BlogAiModelCanaryCheckV4 = {
  stage: BlogDeepSeekStage;
  provider: 'deepseek' | 'gemini';
  model: string;
  deepseekThinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'high' | 'max';
};

export function buildBlogAiModelCanaryChecksV4(): BlogAiModelCanaryCheckV4[] {
  return BLOG_AI_MODEL_CANARY_STAGES_V4.map((stage) => {
    const execution = resolveBlogGenerationModelV4(stage);
    if (!execution) throw new Error(`blog_ai_canary_model_unavailable:${stage}`);
    return { stage, ...execution };
  });
}

export function validateBlogAiModelCanaryResultV4(input: {
  check: BlogAiModelCanaryCheckV4;
  text: string;
  receipt: BlogAiUsageReceipt;
}): string[] {
  const failures: string[] = [];
  if (input.text.trim() !== 'OK') failures.push('unexpected_response');
  if (input.receipt.provider !== input.check.provider) failures.push('provider_mismatch');
  if (input.receipt.model !== input.check.model) failures.push('model_mismatch');
  if (input.receipt.finishReason?.toLowerCase() !== 'stop') failures.push('finish_reason_not_stop');
  if (input.check.provider === 'deepseek'
    && input.receipt.thinkingMode !== input.check.deepseekThinking) {
    failures.push('thinking_mode_mismatch');
  }
  if (Number(input.receipt.usage?.outputTokens ?? 0) <= 0) failures.push('output_usage_missing');
  return failures;
}
