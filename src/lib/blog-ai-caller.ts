/**
 * Blog AI Caller — Gemini / DeepSeek / Claude 통합 라우터
 *
 * BLOG_AI_MODEL 환경변수(또는 prompt-version.ts 기본값)에 따라
 * 적절한 LLM SDK로 라우팅한다. JSON 모드 + 자유 텍스트 모드.
 *
 * 사용처: content-pipeline 에이전트들 (instagram-caption, kakao-channel, meta-ads, ...)
 *
 * ⚡ 클라이언트 인스턴스 캐싱:
 *   매 호출마다 new OpenAI/Anthropic/GoogleGenerativeAI 생성하면
 *   - HTTP keep-alive 풀 미공유 → cold connect overhead 200~500ms
 *   - 시간당 publisher처럼 반복 호출 시 누적 비용
 *   → API 키별로 한 번만 생성해 모듈 톱-레벨에서 캐시.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';
import { getProviderApiKey, resolveAiPolicy } from '@/lib/ai-provider-policy';

export interface BlogCallOptions {
  temperature?: number;
  systemPrompt?: string;
  maxTokens?: number;
}

function isDeepSeekModel(model: string): boolean {
  return model.startsWith('deepseek');
}
function isClaudeModel(model: string): boolean {
  return model.startsWith('claude');
}

// ────────────────────────────────────────────────────────────────────────────
// 싱글톤 클라이언트 캐시 — API 키별로 1회만 생성
// ────────────────────────────────────────────────────────────────────────────

let cachedDeepseekKey: string | null = null;
let cachedDeepseek: OpenAI | null = null;
function getDeepseekClient(): OpenAI {
  const apiKey = getProviderApiKey('deepseek');
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 미설정');
  if (cachedDeepseek && cachedDeepseekKey === apiKey) return cachedDeepseek;
  cachedDeepseek = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' });
  cachedDeepseekKey = apiKey;
  return cachedDeepseek;
}

let cachedAnthropicKey: string | null = null;
let cachedAnthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  const apiKey = getProviderApiKey('claude');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 미설정');
  if (cachedAnthropic && cachedAnthropicKey === apiKey) return cachedAnthropic;
  cachedAnthropic = new Anthropic({ apiKey });
  cachedAnthropicKey = apiKey;
  return cachedAnthropic;
}

let cachedGeminiKey: string | null = null;
let cachedGemini: GoogleGenerativeAI | null = null;
function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = getProviderApiKey('gemini');
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY 미설정');
  if (cachedGemini && cachedGeminiKey === apiKey) return cachedGemini;
  cachedGemini = new GoogleGenerativeAI(apiKey);
  cachedGeminiKey = apiKey;
  return cachedGemini;
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * JSON 문자열을 반환하는 단일 LLM 호출.
 * - deepseek-v4-* → api.deepseek.com (OpenAI 호환)
 * - claude-* → api.anthropic.com
 * - gemini-* → googleapis.com (Google Generative AI)
 *
 * 키 미설정 시 에러를 throw → 호출 측 callWithZodValidation 이 catch → fallback.
 */
export async function generateBlogJSON(
  prompt: string,
  opts: BlogCallOptions = {},
): Promise<string> {
  const policy = resolveAiPolicy('blog-generate', 'fast', BLOG_AI_MODEL);
  const model = policy.model;
  const temperature = opts.temperature ?? 0.85;

  if (isDeepSeekModel(model)) {
    const client = getDeepseekClient();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const r = await client.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
      temperature,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    });
    return r.choices[0]?.message?.content ?? '{}';
  }

  if (isClaudeModel(model)) {
    const client = getAnthropicClient();
    const r = await client.messages.create({
      model,
      max_tokens: opts.maxTokens || 2000,
      temperature,
      system: opts.systemPrompt
        ? [{ type: 'text' as const, text: opts.systemPrompt, cache_control: { type: 'ephemeral' as const } }]
        : undefined,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = r.content.filter((x) => x.type === 'text').map((x) => (x as Anthropic.TextBlock).text).join('\n');
    return text || '{}';
  }

  // Gemini
  const genAI = getGeminiClient();
  const gmodel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
    },
    ...(opts.systemPrompt ? { systemInstruction: opts.systemPrompt } : {}),
  });
  const r = await gmodel.generateContent(prompt);
  return r.response.text();
}

/**
 * 마크다운/텍스트를 반환하는 단일 LLM 호출 (JSON 모드 없음).
 * 블로그 본문 생성 등 자유 형식 텍스트 출력에 사용.
 */
export async function generateBlogText(
  prompt: string,
  opts: BlogCallOptions = {},
): Promise<string> {
  const policy = resolveAiPolicy('blog-generate', 'fast', BLOG_AI_MODEL);
  const model = policy.model;
  const temperature = opts.temperature ?? 0.85;

  if (isDeepSeekModel(model)) {
    const client = getDeepseekClient();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const r = await client.chat.completions.create({
      model,
      messages,
      temperature,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    });
    return r.choices[0]?.message?.content ?? '';
  }

  if (isClaudeModel(model)) {
    const client = getAnthropicClient();
    const r = await client.messages.create({
      model,
      max_tokens: opts.maxTokens || 2000,
      temperature,
      system: opts.systemPrompt
        ? [{ type: 'text' as const, text: opts.systemPrompt, cache_control: { type: 'ephemeral' as const } }]
        : undefined,
      messages: [{ role: 'user', content: prompt }],
    });
    return r.content.filter((x) => x.type === 'text').map((x) => (x as Anthropic.TextBlock).text).join('\n');
  }

  // Gemini
  const genAI = getGeminiClient();
  const gmodel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature,
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
    },
    ...(opts.systemPrompt ? { systemInstruction: opts.systemPrompt } : {}),
  });
  const r = await gmodel.generateContent(prompt);
  return r.response.text();
}

/** API 키가 설정돼 있는지 확인 (fallback 분기용) */
export function hasBlogApiKey(): boolean {
  const policy = resolveAiPolicy('blog-generate', 'fast', BLOG_AI_MODEL);
  return !!getProviderApiKey(policy.provider);
}

/**
 * 테스트/디버깅용 — 캐시된 클라이언트 리셋 (API 키 교체 후 호출).
 * production NODE_ENV 에서는 호출해도 no-op (실수 방어).
 */
export function _resetBlogAiClientCacheForTest(): void {
  if (process.env.NODE_ENV === 'production') {
    console.warn('[blog-ai-caller] _resetBlogAiClientCacheForTest 는 production 에서 no-op');
    return;
  }
  cachedDeepseek = null; cachedDeepseekKey = null;
  cachedAnthropic = null; cachedAnthropicKey = null;
  cachedGemini = null; cachedGeminiKey = null;
}
