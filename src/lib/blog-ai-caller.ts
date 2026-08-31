/**
 * Blog AI Caller — Gemini / DeepSeek / Claude 통합 라우터
 *
 * BLOG_AI_MODEL 환경변수(또는 prompt-version.ts 기본값)에 따라
 * 적절한 LLM SDK로 라우팅한다. JSON 모드 + 자유 텍스트 모드.
 *
 * ── V4: FrugalGPT Cascade (2026-05-27) ──
 *   generateBlogJSON(), generateBlogText() 에 cascade 파라미터를 추가:
 *   cascade={ firstTry: 'gemini', fallback: 'deepseek' }
 *   - Gemini 2.5 Flash (input $0.075/M) 로 1차 시도
 *   - JSON parse 실패 또는 quality 부족 시 DeepSeek V4 Flash ($0.014/M) 로 재시도
 *   - DeepSeek도 실패하면 기존 ROUTING fallback (Gemini 재시도 → Claude)
 *   - cascade=false 면 기존처럼 단일 모델로 직행 (블록 생성 등 quality-critical)
 *   - cascade=true 가 기본 — 낮은 quality 작업은 싼 모델로 먼저.
 *
 * 사용처: content-pipeline 에이전트들 (instagram-caption, kakao-channel, meta-ads, ...)
 *
 * ⚡ 클라이언트 인스턴스 캐싱:
 *   매 호출마다 new OpenAI/Anthropic/GoogleGenerativeAI 생성하면
 *   - HTTP keep-alive 풀 미공유 → cold connect overhead 200~500ms
 *   - 시간당 publisher처럼 반복 호출 시 누적 비용
 *   → API 키별로 한 번만 생성해 모듈 톱-레벨에서 캐시.
 *
 * ⚡ DeepSeek Context Caching 최적화:
 *   - 시스템 프롬프트 앞에 공통 prefix (회사 정보, 정책 등) 를 두어
 *     cache hit 시 input token 90% 할인
 *   - 긴 systemPrompt는 자동 prefix 분리
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { BLOG_AI_MODEL } from '@/lib/prompt-version';
import { getProviderApiKey, resolveAiPolicy } from '@/lib/ai-provider-policy';
import {
  calculateDeepSeekCostV4,
  type DeepSeekCostReceiptV4,
} from '@/lib/blog-deepseek-orchestrator-v4';

export interface BlogCallOptions {
  /** Explicit model bypasses the general AI policy. Blog V4 uses this to remain DeepSeek-only. */
  model?: string;
  temperature?: number;
  systemPrompt?: string;
  maxTokens?: number;
  /** Per-provider network budget. The caller's outer deadline should remain larger. */
  requestTimeoutMs?: number;
  /** Gemini 2.5 reasoning budget. Use zero for grounded transformation tasks. */
  thinkingBudget?: number;
  /** DeepSeek V4 thinking is explicit so draft calls never inherit a provider default. */
  deepseekThinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'low' | 'high' | 'max';
  /**
   * Claude prompt cache TTL 을 1h 로 확장 (기본 5min ephemeral).
   * 동일 systemPrompt 로 1시간 내 2회 이상 호출되는 워크로드(시간당 publisher,
   * 카드뉴스 N개 일괄 생성, 7-플랫폼 fan-out 등)에 적용 시 net 절감.
   * DeepSeek/Gemini 에는 영향 없음 — 두 공급자는 자동 prompt cache.
   * Anthropic SDK 는 ttl 필드를 비표준으로 받아 anthropic-beta 헤더 자동 처리.
   */
  longCache?: boolean;
  /**
   * FrugalGPT cascade (V4):
   * - true (기본): Gemini Flash → DeepSeek Flash → fallback
   * - false: 설정된 policy 모델로 직행 (quality-critical 용)
   * - { firstTry: 'gemini', fallback: 'deepseek' }: 커스텀 cascade
   *
   * JSON 모드에서 cascade=true 시:
   *   1. Gemini Flash 로 1차 시도
   *   2. JSON parse 실패 또는 결과가 '{}' 면 DeepSeek 으로 재시도
   *   3. 둘 다 실패하면 에러 throw
   */
  cascade?: boolean | {
    firstTry: string;
    fallback: string;
    firstTryTimeoutMs?: number;
    fallbackTimeoutMs?: number;
  };
}

export interface BlogAiUsageReceipt {
  provider: 'deepseek' | 'claude' | 'gemini';
  model: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  finishReason: string | null;
  thinkingMode?: 'enabled' | 'disabled' | null;
  deepseekCost: DeepSeekCostReceiptV4 | null;
  /** Provider-neutral usage retained even when no trustworthy price is configured. */
  usage?: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  } | null;
  /** Null means the caller must retain its conservative budget reservation. */
  estimatedCostUsd?: number | null;
  /** Durable, non-secret audit evidence added by a higher-level caller. */
  audit?: Record<string, unknown>;
}

export interface BlogAiTextResult {
  text: string;
  receipt: BlogAiUsageReceipt;
}

export type BlogAiResponseErrorCode =
  | 'blog_ai_empty_response'
  | 'blog_ai_truncated_response'
  | 'blog_ai_incomplete_response'
  | 'blog_ai_malformed_json_response';

export type BlogAiProviderFailureCode = BlogAiResponseErrorCode
  | 'blog_ai_generation_timeout'
  | 'blog_ai_transport_error'
  | 'blog_ai_rate_limited'
  | 'blog_ai_provider_unavailable';

/**
 * Fail-closed provider response error.
 *
 * Durable generation callers can persist `receipt` for cost/audit purposes,
 * but must never treat the partial provider text as an article. The text is
 * deliberately not retained on the error to avoid leaking a cut-off draft to
 * logs or accidentally recovering it as publishable content.
 */
export class BlogAiResponseError extends Error {
  readonly code: BlogAiResponseErrorCode;
  readonly receipt: BlogAiUsageReceipt;
  readonly outputCharacters: number;

  constructor(input: {
    code: BlogAiResponseErrorCode;
    receipt: BlogAiUsageReceipt;
    outputCharacters: number;
  }) {
    const finishReason = input.receipt.finishReason ?? 'missing';
    super(
      `${input.code}:provider=${input.receipt.provider}:model=${input.receipt.model}`
      + `:finish_reason=${finishReason}:output_chars=${input.outputCharacters}`,
    );
    this.name = 'BlogAiResponseError';
    this.code = input.code;
    this.receipt = input.receipt;
    this.outputCharacters = input.outputCharacters;
  }
}

/**
 * Converts provider failures that happened after a budget reservation into a
 * durable, retryable error code. Unknown application errors remain null so a
 * prompt or schema bug is never mislabeled as a transient provider incident.
 */
export function classifyBlogAiProviderFailure(
  error: unknown,
): BlogAiProviderFailureCode | null {
  if (error instanceof BlogAiResponseError) return error.code;

  const record = error && typeof error === 'object'
    ? error as { status?: unknown; code?: unknown; message?: unknown; cause?: unknown }
    : null;
  const status = Number(record?.status);
  const code = String(record?.code ?? '').trim();
  const message = error instanceof Error
    ? error.message
    : String(record?.message ?? error ?? '');
  const cause = record?.cause instanceof Error
    ? `${record.cause.name}:${record.cause.message}`
    : String(record?.cause ?? '');
  const signal = `${code} ${message} ${cause}`;

  if (/blog_ai_generation_timeout:\d+ms/i.test(signal)) {
    return 'blog_ai_generation_timeout';
  }
  if (status === 429 || /(?:rate.?limit|too many requests|\b429\b)/i.test(signal)) {
    return 'blog_ai_rate_limited';
  }
  if (
    (Number.isFinite(status) && status >= 500 && status <= 599)
    || /(?:provider[_ -]?unavailable|bad gateway|service unavailable|gateway timeout)/i.test(signal)
  ) {
    return 'blog_ai_provider_unavailable';
  }
  if (
    /(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR_|fetch failed|network|socket hang up|connection (?:error|reset|closed))/i
      .test(signal)
  ) {
    return 'blog_ai_transport_error';
  }
  return null;
}

function assertCompleteProviderResponse(input: {
  text: string;
  receipt: BlogAiUsageReceipt;
  jsonMode: boolean;
}): void {
  const text = input.text.trim();
  const outputCharacters = Array.from(text).length;
  if (!text) {
    throw new BlogAiResponseError({
      code: 'blog_ai_empty_response',
      receipt: input.receipt,
      outputCharacters,
    });
  }

  // OpenAI-compatible DeepSeek responses use `length` when max_tokens cuts
  // output off. Accept only an explicit normal stop at this durable boundary;
  // missing or provider-specific termination states are not proof of a
  // complete article.
  if (input.receipt.finishReason?.toLowerCase() !== 'stop') {
    const normalizedReason = input.receipt.finishReason?.toLowerCase() ?? '';
    const truncated = normalizedReason === 'length'
      || normalizedReason === 'max_tokens'
      || normalizedReason === 'max_output_tokens';
    throw new BlogAiResponseError({
      code: truncated ? 'blog_ai_truncated_response' : 'blog_ai_incomplete_response',
      receipt: input.receipt,
      outputCharacters,
    });
  }

  if (input.jsonMode) {
    try {
      JSON.parse(text);
    } catch {
      throw new BlogAiResponseError({
        code: 'blog_ai_malformed_json_response',
        receipt: input.receipt,
        outputCharacters,
      });
    }
  }
}

function withRequestTimeout(
  opts: BlogCallOptions,
  requestTimeoutMs: number | undefined,
): BlogCallOptions {
  return requestTimeoutMs
    ? { ...opts, requestTimeoutMs }
    : opts;
}

// Anthropic SDK 타입이 ttl 을 직접 노출하지 않아 캐스팅 — 런타임은 그대로 통과.
type CacheControlEphemeral = { type: 'ephemeral'; ttl?: '5m' | '1h' };
function buildCacheControl(longCache: boolean | undefined): CacheControlEphemeral {
  return longCache ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
}

function isDeepSeekModel(model: string): boolean {
  return model.startsWith('deepseek');
}
function isClaudeModel(model: string): boolean {
  return model.startsWith('claude');
}

function providerName(modelOrProvider: string): 'deepseek' | 'claude' | 'gemini' {
  if (isDeepSeekModel(modelOrProvider) || modelOrProvider === 'deepseek') return 'deepseek';
  if (isClaudeModel(modelOrProvider) || modelOrProvider === 'claude') return 'claude';
  return 'gemini';
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
 * cascade=true (기본) 시 FrugalGPT 패턴으로 저가 모델 먼저 시도.
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
  const cascade = opts.cascade ?? true;
  const policy = resolveAiPolicy('blog-generate', 'fast', BLOG_AI_MODEL);
  const directModel = opts.model || policy.model;
  const temperature = opts.temperature ?? 0.85;

  if (cascade) {
    // FrugalGPT cascade: cheap model first, fallback on failure
    const config = typeof cascade === 'object' ? cascade : { firstTry: 'gemini', fallback: 'deepseek' };
    const errors: string[] = [];
    const attemptedProviders = new Set<string>();

    // 1st try: cheap model (Gemini Flash)
    try {
      attemptedProviders.add(providerName(config.firstTry));
      const firstResult = await callModelDirect(
        config.firstTry,
        prompt,
        withRequestTimeout(opts, config.firstTryTimeoutMs),
        true,
      );
      if (firstResult && firstResult !== '{}') {
        return firstResult;
      }
      errors.push(`${config.firstTry}: empty result`);
    } catch (e) {
      errors.push(`${config.firstTry}: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2nd try: fallback model (DeepSeek Flash)
    try {
      attemptedProviders.add(providerName(config.fallback));
      const secondResult = await callModelDirect(
        config.fallback,
        prompt,
        withRequestTimeout(opts, config.fallbackTimeoutMs),
        true,
      );
      if (secondResult && secondResult !== '{}') {
        return secondResult;
      }
      errors.push(`${config.fallback}: empty result`);
    } catch (e) {
      errors.push(`${config.fallback}: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Both failed — try configured policy model as last resort
    if (
      (isDeepSeekModel(policy.model) || policy.provider === 'gemini')
      && !attemptedProviders.has(providerName(policy.model))
    ) {
      const lastTry = await callModelDirect(policy.model, prompt, opts, true).catch((e) => {
        errors.push(`policy(${policy.model}): ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (lastTry) return lastTry;
    }

    throw new Error(`FrugalGPT cascade all failed: ${errors.join('; ')}`);
  }

  // Legacy direct path (cascade=false)
  return callModelDirect(directModel, prompt, opts, true);
}

/**
 * 마크다운/텍스트를 반환하는 단일 LLM 호출 (JSON 모드 없음).
 * 블로그 본문 생성 등 자유 형식 텍스트 출력에 사용.
 * cascade=true 시 Gemini → DeepSeek 순으로 시도.
 */
export async function generateBlogText(
  prompt: string,
  opts: BlogCallOptions = {},
): Promise<string> {
  const cascade = opts.cascade ?? true;
  const policy = resolveAiPolicy('blog-generate', 'fast', BLOG_AI_MODEL);
  const directModel = opts.model || policy.model;
  const temperature = opts.temperature ?? 0.85;

  if (cascade) {
    const config = typeof cascade === 'object' ? cascade : { firstTry: 'gemini', fallback: 'deepseek' };
    const errors: string[] = [];
    const attemptedProviders = new Set<string>();

    try {
      attemptedProviders.add(providerName(config.firstTry));
      const result = await callModelDirect(
        config.firstTry,
        prompt,
        withRequestTimeout(opts, config.firstTryTimeoutMs),
        false,
      );
      if (result && result.length > 20) return result;
      errors.push(`${config.firstTry}: too short or empty`);
    } catch (e) {
      errors.push(`${config.firstTry}: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      attemptedProviders.add(providerName(config.fallback));
      const result = await callModelDirect(
        config.fallback,
        prompt,
        withRequestTimeout(opts, config.fallbackTimeoutMs),
        false,
      );
      if (result && result.length > 20) return result;
      errors.push(`${config.fallback}: too short or empty`);
    } catch (e) {
      errors.push(`${config.fallback}: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (
      (isDeepSeekModel(policy.model) || policy.provider === 'gemini')
      && !attemptedProviders.has(providerName(policy.model))
    ) {
      const lastTry = await callModelDirect(policy.model, prompt, opts, false).catch((e) => {
        errors.push(`policy(${policy.model}): ${e instanceof Error ? e.message : String(e)}`);
        return '';
      });
      if (lastTry) return lastTry;
    }

    throw new Error(`FrugalGPT cascade (text) all failed: ${errors.join('; ')}`);
  }

  return callModelDirect(directModel, prompt, opts, false);
}

/**
 * Receipt-bearing direct call for durable generation attempts.
 * A model must be explicit: silently falling back to another provider would invalidate cost and audit records.
 */
export async function generateBlogTextWithReceipt(
  prompt: string,
  opts: BlogCallOptions & { model: string },
): Promise<BlogAiTextResult> {
  return callModelDirectWithReceipt(opts.model, prompt, { ...opts, cascade: false }, false);
}

// ── Internal: model name → direct call ──────────────────────

async function callModelDirect(
  modelOrProvider: string,
  prompt: string,
  opts: BlogCallOptions,
  jsonMode: boolean,
): Promise<string> {
  return (await callModelDirectWithReceipt(modelOrProvider, prompt, opts, jsonMode)).text;
}

async function callModelDirectWithReceipt(
  modelOrProvider: string,
  prompt: string,
  opts: BlogCallOptions,
  jsonMode: boolean,
): Promise<BlogAiTextResult> {
  const started = new Date();
  const startedMs = Date.now();
  const temperature = opts.temperature ?? 0.85;
  const requestOptions = opts.requestTimeoutMs
    ? { timeout: opts.requestTimeoutMs, maxRetries: 0 }
    : undefined;

  if (isDeepSeekModel(modelOrProvider) || modelOrProvider === 'deepseek') {
    const model = modelOrProvider === 'deepseek' ? 'deepseek-v4-flash' : modelOrProvider;
    const client = getDeepseekClient();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const thinking = opts.deepseekThinking ?? 'disabled';
    const requestBody = {
        model,
        messages,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(thinking === 'disabled' ? { temperature } : {}),
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        // The JavaScript OpenAI client forwards unknown request-body fields
        // directly. DeepSeek's Node example therefore uses the top-level
        // `thinking` field; `extra_body` is the Python SDK spelling and would
        // be sent as a literal, ignored field here.
        thinking: { type: thinking },
        ...(thinking === 'enabled' ? { reasoning_effort: opts.reasoningEffort ?? 'high' } : {}),
      };
    const r = await client.chat.completions.create(
      requestBody as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      requestOptions,
    );
    const completed = new Date();
    const rawUsage = (r.usage ?? {}) as Record<string, unknown>;
    const inputTokens = Number(rawUsage.prompt_tokens || 0);
    const cacheHitInputTokens = Number(
      rawUsage.prompt_cache_hit_tokens
      || (rawUsage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens
      || 0,
    );
    const cacheMissInputTokens = Number(
      rawUsage.prompt_cache_miss_tokens || Math.max(0, inputTokens - cacheHitInputTokens),
    );
    const result: BlogAiTextResult = {
      text: r.choices[0]?.message?.content ?? '',
      receipt: {
        provider: 'deepseek', model, startedAt: started.toISOString(), completedAt: completed.toISOString(),
        latencyMs: Math.max(0, Date.now() - startedMs),
        finishReason: r.choices[0]?.finish_reason ?? null,
        thinkingMode: thinking,
        deepseekCost: calculateDeepSeekCostV4(model, {
          inputTokens,
          cacheHitInputTokens,
          cacheMissInputTokens,
          outputTokens: Number(rawUsage.completion_tokens || 0),
        }, completed),
      },
    };
    result.receipt.usage = {
      inputTokens,
      cachedInputTokens: cacheHitInputTokens,
      outputTokens: Number(rawUsage.completion_tokens || 0),
    };
    result.receipt.estimatedCostUsd = result.receipt.deepseekCost?.estimatedCostUsd ?? null;
    assertCompleteProviderResponse({ ...result, jsonMode });
    return result;
  }

  if (isClaudeModel(modelOrProvider) || modelOrProvider === 'claude') {
    const model = modelOrProvider === 'claude' ? 'claude-sonnet-4-6' : modelOrProvider;
    const client = getAnthropicClient();
    const r = await client.messages.create(
      {
        model,
        max_tokens: opts.maxTokens || 2000,
        temperature,
        system: opts.systemPrompt
          ? [{ type: 'text' as const, text: opts.systemPrompt, cache_control: buildCacheControl(opts.longCache) as { type: 'ephemeral' } }]
          : undefined,
        messages: [{ role: 'user', content: prompt }],
      },
      requestOptions,
    );
    const text = r.content.filter((x) => x.type === 'text').map((x) => (x as Anthropic.TextBlock).text).join('\n');
    return {
      text: text || '',
      receipt: {
        provider: 'claude', model, startedAt: started.toISOString(), completedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Date.now() - startedMs), finishReason: r.stop_reason ?? null, deepseekCost: null,
      },
    };
  }

  // Gemini
  const model = modelOrProvider === 'gemini' ? 'gemini-2.5-flash' : modelOrProvider;
  const genAI = getGeminiClient();
  const gmodel = genAI.getGenerativeModel(
    {
      model,
      generationConfig: {
        temperature,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
        ...(typeof opts.thinkingBudget === 'number'
          ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } }
          : {}),
      },
      ...(opts.systemPrompt ? { systemInstruction: opts.systemPrompt } : {}),
    },
    opts.requestTimeoutMs ? { timeout: opts.requestTimeoutMs } : undefined,
  );
  const r = await gmodel.generateContent(prompt);
  const response = r.response;
  const usage = response.usageMetadata;
  const result: BlogAiTextResult = {
    text: response.text(),
    receipt: {
      provider: 'gemini', model, startedAt: started.toISOString(), completedAt: new Date().toISOString(),
      latencyMs: Math.max(0, Date.now() - startedMs),
      finishReason: (response.candidates?.[0] as { finishReason?: string } | undefined)?.finishReason ?? null,
      deepseekCost: null,
      usage: {
        inputTokens: Math.max(0, Number(usage?.promptTokenCount || 0)),
        cachedInputTokens: Math.max(0, Number(usage?.cachedContentTokenCount || 0)),
        outputTokens: Math.max(0, Number(usage?.candidatesTokenCount || 0)),
      },
      estimatedCostUsd: null,
    },
  };
  assertCompleteProviderResponse({ ...result, jsonMode });
  return result;
}

/** API 키가 설정돼 있는지 확인 (fallback 분기용) */
export function hasBlogApiKey(model?: string): boolean {
  if (model) return !!getProviderApiKey(providerName(model));
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
