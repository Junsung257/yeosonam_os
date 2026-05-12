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

  // class constructor mock — `new OpenAI(...)` 호출 시 인스턴스 1회 생성 추적
  const OpenAICtor = vi.fn(function (this: { chat: unknown }) {
    this.chat = { completions: { create: dsCreate } };
  });
  const AnthropicCtor = vi.fn(function (this: { messages: unknown }) {
    this.messages = { create: claudeCreate };
  });
  const GeminiCtor = vi.fn(function (this: { getGenerativeModel: unknown }) {
    this.getGenerativeModel = vi.fn(() => ({ generateContent: geminiGenContent }));
  });

  return { dsCreate, claudeCreate, geminiGenContent, OpenAICtor, AnthropicCtor, GeminiCtor };
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
    // 모듈-레벨 캐시 변수 리셋
    const mod = await import('./blog-ai-caller');
    mod._resetBlogAiClientCacheForTest();
  });

  it('_resetBlogAiClientCacheForTest / generateBlogJSON / hasBlogApiKey 가 export', async () => {
    const mod = await import('./blog-ai-caller');
    expect(typeof mod._resetBlogAiClientCacheForTest).toBe('function');
    expect(typeof mod.generateBlogJSON).toBe('function');
    expect(typeof mod.generateBlogText).toBe('function');
    expect(typeof mod.hasBlogApiKey).toBe('function');
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
    mocks.dsCreate.mockResolvedValue({ choices: [{ message: { content: '{"x":1}' } }] });

    const { generateBlogJSON } = await import('./blog-ai-caller');
    await generateBlogJSON('p1');
    await generateBlogJSON('p2');
    await generateBlogJSON('p3');

    expect(mocks.OpenAICtor).toHaveBeenCalledTimes(1); // 싱글톤 보장
    expect(mocks.dsCreate).toHaveBeenCalledTimes(3);   // 호출은 3회
  });

  it('API 키 교체 → 새 SDK 인스턴스 생성 (캐시 무효화)', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-1';
    mocks.dsCreate.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });

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
    mocks.dsCreate.mockResolvedValue({ choices: [{ message: { content: 'plain text' } }] });

    const { generateBlogJSON, generateBlogText } = await import('./blog-ai-caller');
    await generateBlogJSON('p1');
    await generateBlogText('p2');
    await generateBlogJSON('p3');

    expect(mocks.OpenAICtor).toHaveBeenCalledTimes(1); // JSON / text 가 인스턴스 공유
  });
});
