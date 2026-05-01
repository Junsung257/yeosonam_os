/**
 * Blog AI Caller — Gemini / DeepSeek 통합 라우터
 *
 * BLOG_AI_MODEL 환경변수(또는 prompt-version.ts 기본값)에 따라
 * 적절한 LLM SDK로 라우팅한다. JSON 모드 전용.
 *
 * 사용처: content-pipeline 에이전트들 (instagram-caption, kakao-channel, meta-ads, ...)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';

export interface BlogCallOptions {
  temperature?: number;
  systemPrompt?: string;
  maxTokens?: number;
}

function isDeepSeekModel(model: string): boolean {
  return model.startsWith('deepseek');
}

/**
 * JSON 문자열을 반환하는 단일 LLM 호출.
 * - deepseek-v4-* → api.deepseek.com (OpenAI 호환)
 * - gemini-* → googleapis.com (Google Generative AI)
 *
 * 키 미설정 시 에러를 throw → 호출 측 callWithZodValidation 이 catch → fallback.
 */
export async function generateBlogJSON(
  prompt: string,
  opts: BlogCallOptions = {},
): Promise<string> {
  const model = BLOG_AI_MODEL;
  const temperature = opts.temperature ?? 0.85;

  if (isDeepSeekModel(model)) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY 미설정');

    const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' });
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

  // Gemini
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY 미설정');

  const genAI = new GoogleGenerativeAI(apiKey);
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
  const model = BLOG_AI_MODEL;
  const temperature = opts.temperature ?? 0.85;

  if (isDeepSeekModel(model)) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY 미설정');

    const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com' });
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

  // Gemini
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY 미설정');

  const genAI = new GoogleGenerativeAI(apiKey);
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
  if (isDeepSeekModel(BLOG_AI_MODEL)) return !!process.env.DEEPSEEK_API_KEY;
  return !!(process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY);
}
