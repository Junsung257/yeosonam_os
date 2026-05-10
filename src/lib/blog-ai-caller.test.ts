/**
 * @file blog-ai-caller.test.ts
 * @description blog-ai-caller 공개 API 동작 회귀 방지.
 *
 * 싱글톤 클라이언트 캐싱은 LLM SDK 클래스 mock이 까다로워 직접 단위테스트 대신,
 * `_resetBlogAiClientCacheForTest` export 와 `hasBlogApiKey` 분기 동작만 검증.
 * 실제 캐싱 동작은 모듈-레벨 let 변수로 단순 구현되어 정적으로 자명.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
vi.mock('@/lib/prompt-version', () => ({ BLOG_AI_MODEL: 'deepseek-v4-flash' }));

describe('blog-ai-caller — 공개 API', () => {
  beforeEach(async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it('_resetBlogAiClientCacheForTest 가 export 되어있다', async () => {
    const mod = await import('./blog-ai-caller');
    expect(typeof mod._resetBlogAiClientCacheForTest).toBe('function');
    expect(() => mod._resetBlogAiClientCacheForTest()).not.toThrow();
  });

  it('generateBlogJSON / generateBlogText / hasBlogApiKey 가 export 되어있다', async () => {
    const mod = await import('./blog-ai-caller');
    expect(typeof mod.generateBlogJSON).toBe('function');
    expect(typeof mod.generateBlogText).toBe('function');
    expect(typeof mod.hasBlogApiKey).toBe('function');
  });

  it('hasBlogApiKey: DEEPSEEK_API_KEY 미설정 → false', async () => {
    const { hasBlogApiKey } = await import('./blog-ai-caller');
    expect(hasBlogApiKey()).toBe(false);
  });

  it('hasBlogApiKey: DEEPSEEK_API_KEY 설정 → true', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    const { hasBlogApiKey } = await import('./blog-ai-caller');
    expect(hasBlogApiKey()).toBe(true);
  });

  it('generateBlogJSON: API 키 미설정 시 명확한 에러 throw', async () => {
    const { generateBlogJSON } = await import('./blog-ai-caller');
    await expect(generateBlogJSON('test')).rejects.toThrow(/DEEPSEEK_API_KEY/);
  });
});
