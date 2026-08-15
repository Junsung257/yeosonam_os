/**
 * @file blog-ai-caller.test.ts
 * @description blog-ai-caller 공개 API + 싱글톤 캐싱 회귀 방지.
 *
 * 핵심 보장 (A-1 보강): 같은 API 키로 여러 번 호출 시 SDK constructor 가 1회만 불림.
 * Vitest 4 의 vi.hoisted + class function constructor 패턴으로 mock.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// vi.hoisted — top-level 에서 mock 변수 정의 (vi.mock 보다 먼저 평가됨 보장)
const mocks = vi.hoisted(() => {
  const dsCreate = vi.fn();
  const claudeCreate = vi.fn();
  const geminiGenContent = vi.fn();
  const geminiGetGenerativeModel = vi.fn(() => ({ generateContent: geminiGenContent }));

  // class constructor mock — `new OpenAI(...)` 호출 시 인스턴스 1회 생성 추적
  const OpenAICtor = vi.fn(function (this: { chat: unknown }) {
    this.chat = { completions: { create: dsCreate } };
  });
  const AnthropicCtor = vi.fn(function (this: { messages: unknown }) {
    this.messages = { create: claudeCreate };
  });
  const GeminiCtor = vi.fn(function (this: { getGenerativeModel: unknown }) {
    this.getGenerativeModel = geminiGetGenerativeModel;
  });

  return {
    dsCreate,
    claudeCreate,
    geminiGenContent,
    geminiGetGenerativeModel,
    OpenAICtor,
    AnthropicCtor,
    GeminiCtor,
  };
});

vi.mock('openai', () => ({ default: mocks.OpenAICtor }));
vi.mock('@anthropic-ai/sdk', () => ({ default: mocks.AnthropicCtor }));
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: mocks.GeminiCtor }));

vi.mock('@/lib/ai-provider-policy', () => ({
  getProviderApiKey: (provider: string) => {
    if (provider === 'deepseek') return process.env.DEEPSEEK_API_KEY || null;
    if (provider === 'claude') return process.env.ANTHROPIC_API_KEY || null;
    return process.env.GEMINI_API_KEY || null;
  },
  resolveAiPolicy: (_task: string, _tier: string, model: string) => ({
    provider: model.startsWith('deepseek') ? 'deepseek' : model.startsWith('claude') ? 'claude' : 'gemini',
    model,
  }),
}));

describe('blog-ai-caller — 공개 API', () => {
  beforeEach(async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    mocks.OpenAICtor.mockClear();
    mocks.AnthropicCtor.mockClear();
    mocks.GeminiCtor.mockClear();
    mocks.dsCreate.mockClear();
    mocks.claudeCreate.mockClear();
    mocks.geminiGenContent.mockClear();
    mocks.geminiGetGenerativeModel.mockClear();
    // 모듈-레벨 캐시 변수 리셋
    const mod = await import('./blog-ai-caller');
    mod._resetBlogAiClientCacheForTest();
  });

  it('_resetBlogAiClientCacheForTest / generateBlogJSON / hasBlogApiKey 가 export', async () => {
    const mod = await import('./blog-ai-caller');
    expect(typeof mod._resetBlogAiClientCacheForTest).toBe('function');
    expect(typeof mod.generateBlogJSON).toBe('function');
    expect(typeof mod.generateBlogText).toBe('function');
    expect(typeof mod.generateBlogTextWithReceipt).toBe('function');
    expect(typeof mod.hasBlogApiKey).toBe('function');
  });

  it('DeepSeek V4 direct draft disables thinking and records conservative token cost', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mocks.dsCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'draft response long enough' } }],
      usage: {
        prompt_tokens: 1_000,
        prompt_cache_hit_tokens: 250,
        prompt_cache_miss_tokens: 750,
        completion_tokens: 200,
      },
    });

    const { generateBlogTextWithReceipt } = await import('./blog-ai-caller');
    const result = await generateBlogTextWithReceipt('prompt', {
      model: 'deepseek-v4-flash',
      deepseekThinking: 'disabled',
      temperature: 0.3,
    });

    expect(result.text).toBe('draft response long enough');
    expect(result.receipt).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-flash' });
    expect(result.receipt.deepseekCost?.inputTokens).toBe(1_000);
    expect(mocks.dsCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-v4-flash',
      temperature: 0.3,
      thinking: { type: 'disabled' },
    }), undefined);
  });

  it('DeepSeek Pro rewrite enables thinking without a misleading temperature', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mocks.dsCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: 'rewritten response long enough' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });

    const { generateBlogTextWithReceipt } = await import('./blog-ai-caller');
    await generateBlogTextWithReceipt('prompt', {
      model: 'deepseek-v4-pro',
      deepseekThinking: 'enabled',
      reasoningEffort: 'max',
      temperature: 0.9,
    });

    expect(mocks.dsCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-v4-pro',
      reasoning_effort: 'max',
      thinking: { type: 'enabled' },
    }), undefined);
    expect(mocks.dsCreate.mock.calls[0]?.[0]).not.toHaveProperty('temperature');
  });

  it('hasBlogApiKey: 키 미설정 → false / 설정 → true', async () => {
    const { hasBlogApiKey } = await import('./blog-ai-caller');
    expect(hasBlogApiKey()).toBe(false);
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    expect(hasBlogApiKey()).toBe(true);
  });

  it('generateBlogJSON: API 키 미설정 시 명확한 에러 throw', async () => {
    const { generateBlogJSON } = await import('./blog-ai-caller');
    await expect(generateBlogJSON('test')).rejects.toThrow(/DEEPSEEK_API_KEY/);
  });

  // ── A-1 코드리뷰 fix: 싱글톤 캐싱 실제 동작 검증 ─────────────────────────────
  it('동일 키로 여러 번 호출 → SDK constructor 1회만 (싱글톤 캐싱)', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-1';
    mocks.dsCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"x":1}' } }] });

    const { generateBlogJSON } = await import('./blog-ai-caller');
    await generateBlogJSON('p1');
    await generateBlogJSON('p2');
    await generateBlogJSON('p3');

    expect(mocks.OpenAICtor).toHaveBeenCalledTimes(1); // 싱글톤 보장
    expect(mocks.dsCreate).toHaveBeenCalledTimes(3);   // 호출은 3회
  });

  it('API 키 교체 → 새 SDK 인스턴스 생성 (캐시 무효화)', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-1';
    mocks.dsCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });

    const { generateBlogJSON } = await import('./blog-ai-caller');
    await generateBlogJSON('p1');
    expect(mocks.OpenAICtor).toHaveBeenCalledTimes(1);

    // 키 교체
    process.env.DEEPSEEK_API_KEY = 'sk-test-2';
    await generateBlogJSON('p2');
    expect(mocks.OpenAICtor).toHaveBeenCalledTimes(2); // 재생성 보장
  });

  it('generateBlogText 도 같은 인스턴스 공유 (provider 별 1개)', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mocks.dsCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"article":"plain text response long enough"}' } }],
    });

    const { generateBlogJSON, generateBlogText } = await import('./blog-ai-caller');
    await generateBlogJSON('p1');
    await generateBlogText('p2');
    await generateBlogJSON('p3');

    expect(mocks.OpenAICtor).toHaveBeenCalledTimes(1); // JSON / text 가 인스턴스 공유
  });

  it('passes a per-provider timeout to the underlying SDK request', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mocks.dsCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: 'plain text result' } }] });

    const { generateBlogText } = await import('./blog-ai-caller');
    await generateBlogText('p1', {
      cascade: false,
      requestTimeoutMs: 12_345,
    });

    expect(mocks.dsCreate).toHaveBeenCalledWith(
      expect.any(Object),
      { timeout: 12_345, maxRetries: 0 },
    );
  });

  it('moves to the fallback provider when the first provider times out', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.DEEPSEEK_API_KEY = 'deepseek-test';
    mocks.geminiGenContent.mockRejectedValue(new Error('request timed out'));
    mocks.dsCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: 'fallback article response long enough' } }] });

    const { generateBlogText } = await import('./blog-ai-caller');
    const result = await generateBlogText('p1', {
      maxTokens: 8_192,
      thinkingBudget: 0,
      cascade: {
        firstTry: 'gemini',
        fallback: 'deepseek',
        firstTryTimeoutMs: 55_000,
        fallbackTimeoutMs: 30_000,
      },
    });

    expect(result).toBe('fallback article response long enough');
    expect(mocks.geminiGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({
        generationConfig: expect.objectContaining({
          maxOutputTokens: 8_192,
          thinkingConfig: { thinkingBudget: 0 },
        }),
      }),
      { timeout: 55_000 },
    );
    expect(mocks.geminiGenContent).toHaveBeenCalledWith('p1');
    expect(mocks.dsCreate).toHaveBeenCalledWith(
      expect.any(Object),
      { timeout: 30_000, maxRetries: 0 },
    );
  });

  it('does not retry the same policy provider after both cascade providers fail', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test';
    process.env.DEEPSEEK_API_KEY = 'deepseek-test';
    mocks.geminiGenContent.mockRejectedValue(new Error('gemini failed'));
    mocks.dsCreate.mockRejectedValue(new Error('deepseek failed'));

    const { generateBlogText } = await import('./blog-ai-caller');
    await expect(generateBlogText('p1')).rejects.toThrow(/cascade.*all failed/i);

    expect(mocks.geminiGenContent).toHaveBeenCalledTimes(1);
    expect(mocks.dsCreate).toHaveBeenCalledTimes(1);
  });

  it('fails closed and preserves the receipt when DeepSeek stops at the token limit', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mocks.dsCreate.mockResolvedValue({
      choices: [{ finish_reason: 'length', message: { content: '# partial article\n\ncut off' } }],
      usage: {
        prompt_tokens: 1_000,
        prompt_cache_hit_tokens: 900,
        completion_tokens: 8_192,
      },
    });

    const { BlogAiResponseError, generateBlogTextWithReceipt } = await import('./blog-ai-caller');
    const failure = await generateBlogTextWithReceipt('prompt', {
      model: 'deepseek-v4-pro',
      maxTokens: 8_192,
      deepseekThinking: 'enabled',
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BlogAiResponseError);
    expect(failure).toMatchObject({
      code: 'blog_ai_truncated_response',
      outputCharacters: 26,
      receipt: {
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        finishReason: 'length',
      },
    });
    expect(String((failure as Error).message)).not.toContain('partial article');
  });

  it('fails closed on an empty DeepSeek response even when finish_reason is stop', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mocks.dsCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '  \n ' } }],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    });

    const { generateBlogTextWithReceipt } = await import('./blog-ai-caller');
    await expect(generateBlogTextWithReceipt('prompt', {
      model: 'deepseek-v4-flash',
    })).rejects.toMatchObject({
      code: 'blog_ai_empty_response',
      outputCharacters: 0,
    });
  });

  it('fails closed when DeepSeek omits a normal completion reason', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mocks.dsCreate.mockResolvedValue({
      choices: [{ finish_reason: null, message: { content: 'apparently complete text' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });

    const { generateBlogTextWithReceipt } = await import('./blog-ai-caller');
    await expect(generateBlogTextWithReceipt('prompt', {
      model: 'deepseek-v4-flash',
    })).rejects.toMatchObject({
      code: 'blog_ai_incomplete_response',
      receipt: { finishReason: null },
    });
  });

  it('does not return a cut-off JSON object as a successful DeepSeek result', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    mocks.dsCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"title":"cut off"' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });

    const { generateBlogJSON } = await import('./blog-ai-caller');
    await expect(generateBlogJSON('prompt', { cascade: false }))
      .rejects.toMatchObject({ code: 'blog_ai_malformed_json_response' });
  });
});
