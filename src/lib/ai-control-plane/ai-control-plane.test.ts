import { describe, expect, it } from 'vitest';
import { createInMemoryAiBudgetRepository } from './budget-firewall';
import { invokeAi } from './invoke-ai';
import { estimateAiCostUsd, calculateSettledAiCostUsd } from './pricing';
import { assertRegisteredAiTask, getAiTaskPolicy } from './task-registry';
import { AiControlPlaneError } from './types';

describe('AI control plane', () => {
  it('requires an explicitly registered DeepSeek task with no fallback/advisor', () => {
    const policy = assertRegisteredAiTask('blog-production', 'informational-draft');
    expect(policy.provider).toBe('deepseek');
    expect(policy.maxProviderCalls).toBe(1);
    expect(policy.allowFallback).toBe(false);
    expect(policy.allowAdvisor).toBe(false);
    expect(getAiTaskPolicy('blog-production', 'normalize-complex')).toBeNull();
  });

  it('reserves before calling and settles a successful receipt', async () => {
    const repository = createInMemoryAiBudgetRepository();
    let calls = 0;
    const result = await invokeAi({
      workload: 'blog-production',
      task: 'informational-draft',
      rootJobId: 'job-1',
      candidateId: 'candidate-1',
      stage: 'draft_flash',
      model: 'deepseek-v4-flash',
      idempotencyKey: 'job-1:1',
      promptHash: 'hash-1',
      estimatedMaxInputTokens: 2_000,
      maxOutputTokens: 1_000,
      budgetRepository: repository,
      execute: async () => {
        calls += 1;
        return {
          value: { text: 'ok' }, provider: 'deepseek' as const, model: 'deepseek-v4-flash',
          finishReason: 'stop', usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 },
        };
      },
    });
    expect(result.value).toEqual({ text: 'ok' });
    expect(result.receipt.success).toBe(true);
    expect(result.receipt.traceId).toBe('job-1');
    expect(calls).toBe(1);
    expect(repository.receipts).toHaveLength(1);
    expect(repository.receipts[0]).toMatchObject({ success: true, finishReason: 'stop', traceId: 'job-1' });
  });

  it('settles provider failures and never retries inside the control plane', async () => {
    const repository = createInMemoryAiBudgetRepository();
    let calls = 0;
    await expect(invokeAi({
      workload: 'blog-production',
      task: 'targeted-repair',
      rootJobId: 'job-2',
      candidateId: 'candidate-2',
      stage: 'rewrite_pro_high',
      model: 'deepseek-v4-pro',
      idempotencyKey: 'job-2:2',
      promptHash: 'hash-2',
      estimatedMaxInputTokens: 1_000,
      maxOutputTokens: 1_000,
      budgetRepository: repository,
      execute: async () => {
        calls += 1;
        throw new Error('timeout from provider');
      },
    })).rejects.toMatchObject({ code: 'provider_failed', retryable: true });
    expect(calls).toBe(1);
    expect(repository.receipts).toHaveLength(1);
    expect(repository.receipts[0]).toMatchObject({ success: false, errorCode: 'provider_failed' });
  });

  it('blocks duplicate and provider violations before execution', async () => {
    const repository = createInMemoryAiBudgetRepository();
    const base = {
      workload: 'blog-production' as const,
      task: 'informational-draft' as const,
      rootJobId: 'job-3', candidateId: 'candidate-3', stage: 'draft_flash',
      model: 'deepseek-v4-flash', idempotencyKey: 'job-3:1', promptHash: 'hash-3',
      estimatedMaxInputTokens: 500, maxOutputTokens: 500, budgetRepository: repository,
      execute: async () => ({ value: 'ok', provider: 'deepseek' as const, model: 'deepseek-v4-flash', finishReason: 'stop' }),
    };
    await invokeAi(base);
    await expect(invokeAi(base)).rejects.toMatchObject({ code: 'duplicate_call' });
    await expect(invokeAi({ ...base, idempotencyKey: 'job-3:2', model: 'gemini-2.5-flash' })).rejects.toMatchObject({ code: 'provider_not_allowed' });
    await expect(invokeAi({ ...base, idempotencyKey: 'job-3:3', model: 'deepseek-v3' })).rejects.toMatchObject({ code: 'provider_not_allowed' });
  });

  it('blocks a repeated prompt hash and a second same-class call for one candidate', async () => {
    const repository = createInMemoryAiBudgetRepository({ dailyCapUsd: 10 });
    const input = {
      workload: 'blog-production' as const, task: 'informational-draft' as const,
      rootJobId: 'job-prompt', candidateId: 'candidate-prompt', stage: 'draft_flash',
      model: 'deepseek-v4-flash', promptHash: 'same-prompt', estimatedMaxInputTokens: 500,
      maxOutputTokens: 500, budgetRepository: repository,
      execute: async () => ({ value: 'ok', provider: 'deepseek' as const, model: 'deepseek-v4-flash', finishReason: 'stop' }),
    };
    await invokeAi({ ...input, idempotencyKey: 'job-prompt:1' });
    await expect(invokeAi({ ...input, idempotencyKey: 'job-prompt:2', stage: 'draft_retry' }))
      .rejects.toMatchObject({ code: 'duplicate_call' });
    await expect(invokeAi({ ...input, idempotencyKey: 'job-prompt:3', promptHash: 'new-prompt', stage: 'draft_retry' }))
      .rejects.toMatchObject({ code: 'budget_blocked' });
  });

  it('rejects a callback that returns a provider/model different from the registered task', async () => {
    const repository = createInMemoryAiBudgetRepository();
    await expect(invokeAi({
      workload: 'blog-production', task: 'informational-draft', rootJobId: 'job-3b', candidateId: 'candidate-3b',
      stage: 'draft_flash', model: 'deepseek-v4-flash', idempotencyKey: 'job-3b:1', promptHash: 'hash-3b',
      estimatedMaxInputTokens: 500, maxOutputTokens: 500, budgetRepository: repository,
      execute: async () => ({ value: 'wrong', provider: 'deepseek' as const, model: 'deepseek-v4-pro', finishReason: 'stop' }),
    })).rejects.toMatchObject({ code: 'provider_contract_violation' });
    expect(repository.receipts).toHaveLength(1);
    expect(repository.receipts[0]).toMatchObject({ success: false, errorCode: 'provider_contract_violation' });
  });

  it('uses conservative cache-miss pricing for reservations', () => {
    expect(estimateAiCostUsd({ modelClass: 'pro', estimatedInputTokens: 16_384, maxOutputTokens: 8_192 })).toBeGreaterThan(0);
    expect(calculateSettledAiCostUsd({ modelClass: 'flash', usage: { inputTokens: 100, cachedInputTokens: 50, outputTokens: 20 } })).toBeGreaterThan(0);
  });

  it('fails closed when budget is exhausted', async () => {
    const repository = createInMemoryAiBudgetRepository({ dailyCapUsd: 0.001 });
    await expect(invokeAi({
      workload: 'blog-production', task: 'informational-draft', rootJobId: 'job-4', candidateId: 'candidate-4',
      stage: 'draft_flash', model: 'deepseek-v4-flash', idempotencyKey: 'job-4:1', promptHash: 'hash-4',
      estimatedMaxInputTokens: 100_000, maxOutputTokens: 100_000, budgetRepository: repository,
      execute: async () => ({ value: 'must-not-run', provider: 'deepseek' as const, model: 'deepseek-v4-flash', finishReason: 'stop' }),
    })).rejects.toMatchObject({ code: 'budget_blocked' });
  });

  it('enforces the daily Pro call cap independently of dollar budget', async () => {
    const repository = createInMemoryAiBudgetRepository({ dailyCapUsd: 10, proDailyCallCap: 1 });
    const input = {
      workload: 'blog-production' as const, task: 'targeted-repair' as const,
      rootJobId: 'job-pro-cap', candidateId: 'candidate-pro-cap', stage: 'rewrite_pro_high',
      model: 'deepseek-v4-pro', promptHash: 'hash-pro-cap', estimatedMaxInputTokens: 500,
      maxOutputTokens: 500, budgetRepository: repository,
      execute: async () => ({ value: 'ok', provider: 'deepseek' as const, model: 'deepseek-v4-pro', finishReason: 'stop' }),
    };
    await invokeAi({ ...input, idempotencyKey: 'job-pro-cap:1', candidateId: 'candidate-pro-cap-1' });
    await expect(invokeAi({ ...input, idempotencyKey: 'job-pro-cap:2', candidateId: 'candidate-pro-cap-2' }))
      .rejects.toMatchObject({ code: 'budget_blocked' });
  });

  it('does not expose control-plane errors as generic success', () => {
    expect(new AiControlPlaneError('x', 'budget_unavailable')).toBeInstanceOf(Error);
  });
});
