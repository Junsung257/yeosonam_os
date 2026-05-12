/**
 * @file llm-gateway-timeout.test.ts
 * @description C-2 (코드리뷰 fix) — callModelWithTimeout AbortController 통합.
 *
 * 검증:
 *  1. 정상 응답 시 timeout 분기 미발화, signal abort 만 cleanup 차원에서 호출 (no-op)
 *  2. 응답이 timeout 보다 늦으면 timeout 결과 반환 + AbortSignal aborted=true (inflight SDK cancel)
 *
 * 실제 SDK 클래스 mock — vi.hoisted + class function constructor 패턴.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const dsCreate = vi.fn();
  const OpenAICtor = vi.fn(function (this: { chat: unknown }) {
    this.chat = { completions: { create: dsCreate } };
  });
  const AnthropicCtor = vi.fn(function (this: { messages: unknown }) {
    this.messages = { create: vi.fn() };
  });
  const GeminiCtor = vi.fn(function (this: { getGenerativeModel: unknown }) {
    this.getGenerativeModel = vi.fn(() => ({ generateContent: vi.fn() }));
  });
  return { dsCreate, OpenAICtor, AnthropicCtor, GeminiCtor };
});

vi.mock('openai', () => ({ default: mocks.OpenAICtor }));
vi.mock('@anthropic-ai/sdk', () => ({ default: mocks.AnthropicCtor }));
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: mocks.GeminiCtor }));
vi.mock('@/lib/secret-registry', () => ({
  getSecret: (key: string) => (key === 'DEEPSEEK_API_KEY' ? 'sk-test' : null),
}));
vi.mock('@/lib/ai-provider-policy', () => ({
  getProviderApiKey: (provider: string) =>
    provider === 'deepseek' ? 'sk-test' : null,
  resolveAiPolicy: (_t: string, _tier: string) => ({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
  }),
  resolveAiPolicyRuntime: async (_t: string, _tier: string) => ({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    fallbackProvider: null,
    fallbackModel: null,
    timeoutMs: null,
  }),
}));
vi.mock('@/lib/jarvis/cost-tracker', () => ({
  trackDeepSeekCost: vi.fn(),
  trackCost: vi.fn(),
}));

describe('callModelWithTimeout — C-2 AbortController', () => {
  beforeEach(() => {
    mocks.dsCreate.mockReset();
    mocks.OpenAICtor.mockClear();
    delete process.env.UPSTASH_REDIS_REST_URL;
  });

  it('정상 응답 (timeout 미발화) — 결과 그대로 반환', async () => {
    mocks.dsCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const { llmCall } = await import('./llm-gateway');
    const r = await llmCall({
      task: 'summary',
      systemPrompt: 'sys',
      userPrompt: 'usr',
    });
    expect(r.success).toBe(true);
    expect(r.rawText).toBe('ok');
  });

  it('응답이 timeout 보다 늦으면 timeout 에러 + signal aborted (inflight cancel)', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocks.dsCreate.mockImplementation((_req: unknown, opts?: { signal?: AbortSignal }) => {
      capturedSignal = opts?.signal;
      // 영원히 resolve 안 함 — timeout 으로 race 결정되어야
      return new Promise(() => {});
    });

    process.env.AI_EXECUTOR_TIMEOUT_MS = '100';

    const { llmCall } = await import('./llm-gateway');
    const r = await llmCall({
      task: 'summary',
      systemPrompt: 'sys',
      userPrompt: 'usr',
    });
    expect(r.success).toBe(false);
    // signal 이 SDK 에 전달됐고 race 종료 후 abort 됨
    expect(capturedSignal).toBeDefined();
    // finally 에서 abort 호출 → inflight SDK 가 받음
    expect(capturedSignal!.aborted).toBe(true);

    delete process.env.AI_EXECUTOR_TIMEOUT_MS;
  });
});
