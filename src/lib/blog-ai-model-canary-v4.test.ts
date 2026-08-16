import { describe, expect, it } from 'vitest';
import {
  buildBlogAiModelCanaryChecksV4,
  validateBlogAiModelCanaryResultV4,
} from './blog-ai-model-canary-v4';

describe('Blog V4 AI model canary', () => {
  it('covers the exact production stages and model settings', () => {
    expect(buildBlogAiModelCanaryChecksV4()).toEqual([
      expect.objectContaining({ stage: 'draft_flash', provider: 'deepseek', model: 'deepseek-v4-flash', deepseekThinking: 'disabled' }),
      expect.objectContaining({ stage: 'rewrite_pro_high', provider: 'deepseek', model: 'deepseek-v4-pro', deepseekThinking: 'enabled', reasoningEffort: 'high' }),
      expect.objectContaining({ stage: 'rewrite_pro_max', provider: 'deepseek', model: 'deepseek-v4-pro', deepseekThinking: 'enabled', reasoningEffort: 'max' }),
    ]);
  });

  it('requires exact output, explicit stop, usage, model, provider and thinking parity', () => {
    const check = buildBlogAiModelCanaryChecksV4()[0]!;
    const receipt = {
      provider: 'deepseek' as const,
      model: 'deepseek-v4-flash',
      startedAt: '2026-08-16T00:00:00.000Z',
      completedAt: '2026-08-16T00:00:01.000Z',
      latencyMs: 1000,
      finishReason: 'stop',
      thinkingMode: 'disabled' as const,
      deepseekCost: null,
      usage: { inputTokens: 5, cachedInputTokens: 0, outputTokens: 1 },
    };
    expect(validateBlogAiModelCanaryResultV4({ check, text: 'OK', receipt })).toEqual([]);
    expect(validateBlogAiModelCanaryResultV4({
      check,
      text: 'maybe',
      receipt: { ...receipt, finishReason: 'length', thinkingMode: 'enabled', usage: null },
    })).toEqual(expect.arrayContaining([
      'unexpected_response', 'finish_reason_not_stop', 'thinking_mode_mismatch', 'output_usage_missing',
    ]));
  });
});
