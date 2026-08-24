import type { AiModelClass } from './types';

export const AI_PRICING_VERSION = 'deepseek-2026-08-17' as const;

// Conservative cache-miss pricing in USD per million tokens. Reservations do
// not assume a cache hit; settlement uses the provider receipt.
const PRICES: Record<AiModelClass, { input: number; output: number }> = {
  flash: { input: 0.44, output: 1.32 },
  pro: { input: 1.32, output: 3.96 },
};

export function estimateAiCostUsd(input: {
  modelClass: AiModelClass;
  estimatedInputTokens: number;
  maxOutputTokens: number;
}): number {
  const price = PRICES[input.modelClass];
  const inTokens = Math.max(1, Math.trunc(input.estimatedInputTokens));
  const outTokens = Math.max(1, Math.trunc(input.maxOutputTokens));
  return Number(((inTokens * price.input + outTokens * price.output) / 1_000_000).toFixed(8));
}

export function calculateSettledAiCostUsd(input: {
  modelClass: AiModelClass;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
}): number {
  const price = PRICES[input.modelClass];
  const inputTokens = Math.max(0, Math.trunc(input.usage.inputTokens));
  const cacheHit = Math.min(inputTokens, Math.max(0, Math.trunc(input.usage.cachedInputTokens)));
  const cacheMiss = Math.max(0, inputTokens - cacheHit);
  // Cache-hit price is conservatively treated as half of cache-miss until the
  // effective provider price is explicitly versioned in the control plane.
  return Number(((cacheMiss * price.input + cacheHit * price.input * 0.5
    + Math.max(0, Math.trunc(input.usage.outputTokens)) * price.output) / 1_000_000).toFixed(8));
}
