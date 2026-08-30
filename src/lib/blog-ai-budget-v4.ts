import {
  BLOG_DEEPSEEK_MODELS,
  calculateDeepSeekCostV4,
  resolveBlogGenerationModelV4,
  type BlogDeepSeekStage,
} from './blog-deepseek-orchestrator-v4';

export const BLOG_DAILY_AI_COST_CAP_USD_DEFAULT = 2;
export const BLOG_AI_MAX_INPUT_TOKENS_PER_CALL_DEFAULT = 65_536;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface BlogAiBudgetSnapshotV4 {
  actualUsd: number;
  reservedUsd: number;
  capUsd: number;
}

export interface BlogAiBudgetDecisionV4 extends BlogAiBudgetSnapshotV4 {
  allowed: boolean;
  requestedUsd: number;
  remainingBeforeUsd: number;
  remainingAfterUsd: number;
  reason: 'budget_reserved' | 'daily_ai_cost_cap_reached' | 'invalid_budget_request';
}

function finiteNonNegative(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function money(value: number): number {
  return Number(Math.max(0, value).toFixed(8));
}

export function resolveBlogDailyAiCostCapUsdV4(
  value = process.env.BLOG_DAILY_AI_COST_CAP_USD,
): number {
  return money(finiteNonNegative(value, BLOG_DAILY_AI_COST_CAP_USD_DEFAULT));
}

export function blogBudgetDayKstV4(now = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.toISOString().slice(0, 10);
}

/**
 * Evaluates actual + still-held reservations before a provider call.
 * The database reservation RPC must perform the same comparison atomically;
 * this pure helper is the shared, labeled-fixture contract.
 */
export function evaluateBlogAiBudgetReservationV4(
  snapshot: BlogAiBudgetSnapshotV4,
  requestedUsd: number,
): BlogAiBudgetDecisionV4 {
  const actualUsd = money(finiteNonNegative(snapshot.actualUsd, 0));
  const reservedUsd = money(finiteNonNegative(snapshot.reservedUsd, 0));
  const capUsd = money(finiteNonNegative(snapshot.capUsd, BLOG_DAILY_AI_COST_CAP_USD_DEFAULT));
  if (!Number.isFinite(requestedUsd) || requestedUsd <= 0) {
    return {
      actualUsd, reservedUsd, capUsd, requestedUsd: 0,
      remainingBeforeUsd: money(capUsd - actualUsd - reservedUsd),
      remainingAfterUsd: money(capUsd - actualUsd - reservedUsd),
      allowed: false, reason: 'invalid_budget_request',
    };
  }
  const requested = money(requestedUsd);
  const remainingBeforeUsd = money(capUsd - actualUsd - reservedUsd);
  const allowed = actualUsd + reservedUsd + requested <= capUsd + 1e-9;
  return {
    actualUsd,
    reservedUsd,
    capUsd,
    requestedUsd: requested,
    remainingBeforeUsd,
    remainingAfterUsd: allowed ? money(remainingBeforeUsd - requested) : remainingBeforeUsd,
    allowed,
    reason: allowed ? 'budget_reserved' : 'daily_ai_cost_cap_reached',
  };
}

/**
 * Reserves a conservative maximum before a call. Every blog publication model
 * stage is DeepSeek-only and uses the effective tier price with worst-case
 * cache-miss input/output limits.
 */
export function estimateBlogAiCallReservationUsdV4(input: {
  stage: BlogDeepSeekStage;
  maxOutputTokens: number;
  now?: Date;
  maxInputTokens?: number;
}): number | null {
  resolveBlogGenerationModelV4(input.stage);
  const maxOutputTokens = Math.max(1, Math.trunc(input.maxOutputTokens));
  const model = input.stage === 'draft_flash'
    ? BLOG_DEEPSEEK_MODELS.draft
    : BLOG_DEEPSEEK_MODELS.rewrite;
  return calculateDeepSeekCostV4(model, {
    inputTokens: Math.max(1, Math.trunc(
      input.maxInputTokens ?? BLOG_AI_MAX_INPUT_TOKENS_PER_CALL_DEFAULT,
    )),
    cacheHitInputTokens: 0,
    outputTokens: maxOutputTokens,
  }, input.now ?? new Date()).estimatedCostUsd;
}

/** Conservative reservation for the independent DeepSeek Pro editorial judge. */
export function estimateBlogEditorialJudgeReservationUsdV5(input: {
  maxOutputTokens: number;
  now?: Date;
  maxInputTokens?: number;
}): number {
  return calculateDeepSeekCostV4(BLOG_DEEPSEEK_MODELS.rewrite, {
    inputTokens: Math.max(1, Math.trunc(input.maxInputTokens ?? 24_000)),
    cacheHitInputTokens: 0,
    outputTokens: Math.max(1, Math.trunc(input.maxOutputTokens)),
  }, input.now ?? new Date()).estimatedCostUsd;
}
