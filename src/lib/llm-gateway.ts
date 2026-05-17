/**
 * @file llm-gateway.ts — 통합 LLM 호출 추상화 V3 (DeepSeek 전면 전환)
 *
 * V3 변경사항 (2026-05-01):
 *   1. DeepSeek V4를 전체 primary provider로 전환
 *   2. Gemini Flash를 최종 fallback으로 유지
 *   3. Claude/GPT 라우팅 제거 (비용 최적화)
 *   4. DeepSeek Context Caching 활용 (캐시 히트 시 Input 90% 할인)
 *   5. DeepSeek OpenAI 호환 API 사용 (openai SDK baseURL 변경)
 *
 * 기존 LlmTask 타입 완전 하위호환 유지.
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI, type ResponseSchema } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';

// DeepSeek 의 OpenAI 호환 응답에 추가된 비표준 필드 (prompt cache hit 토큰).
// OpenAI 표준 usage 타입엔 없으므로 별도 격리 — SDK 업데이트 시 회귀 발견 용이.
interface DeepSeekUsageExtension {
  prompt_cache_hit_tokens?: number;
}
import { trackDeepSeekCost, trackCost } from '@/lib/jarvis/cost-tracker';
import { getProviderApiKey, resolveAiPolicy, resolveAiPolicyRuntime } from '@/lib/ai-provider-policy';
import { getSecret } from '@/lib/secret-registry';
import { traceLlmCall, recordLlmUsage } from '@/lib/telemetry/llm-tracer';

// ─── 모델 상수 ───────────────────────────────────────────────────────────────

const MODELS = {
  // DeepSeek V4 (primary)
  DEEPSEEK_FLASH:  'deepseek-v4-flash',
  DEEPSEEK_PRO:    'deepseek-v4-pro',
  // Gemini (fallback only)
  GEMINI_FLASH:    'gemini-2.5-flash',
} as const;

// ─── 타입 ────────────────────────────────────────────────────────────────────

export type LlmTask =
  // 기존 (하위호환)
  | 'extract-meta' | 'card-news' | 'summary' | 'classify' | 'judge'
  // V2 신규
  | 'normalize-simple'   // Flash 1st-pass (명확 필드: 날짜·가격·항공편)
  | 'normalize-complex'  // Pro + advisor (모호한 규칙 적용)
  | 'jarvis-simple'      // Flash (단순 CRUD·조회)
  | 'jarvis-complex'     // Flash executor + Pro advisor (플래닝)
  | 'cross-validate'       // Flash (환각 교차검증)
  | 'blog-generate'        // Flash (콘텐츠 생성)
  | 'content-brief'        // Flash (마케팅 브리프)
  | 'free-travel-extract'  // Flash (자유여행 파라미터 추출)
  | 'free-travel-itinerary' // Flash (자유여행 일자별 슬롯 JSON — DeepSeek 가성비)
  | 'free-travel-compose' // Flash (자유여행 일정 코멘트 생성)
  | 'parse_travel_doc'   // Flash (HWP/PDF 여행상품 구조화 추출 — Gemini 대체)
  // 고객 QA / 품질 (DeepSeek primary — 2026-05)
  | 'qa-chat'              // 공개 상담 챗 JSON 응답
  | 'response-critic'      // Self-RAG 스타일 응답 검증 JSON
  | 'customer-fact-extract'; // 고객 팩트 Mem0 스타일 추출 (원시 JSON 배열)

interface ModelRef {
  provider: 'deepseek' | 'gemini' | 'claude';
  model: string;
}

interface RouteConfig {
  executor: ModelRef;
  advisor?: ModelRef;      // 막힐 때만 1회 호출 — 없으면 advisor 패턴 비활성
  fallback: ModelRef | null;
  maxAdvisorCalls?: number; // 기본 1
  maxRetries?: number;      // V3: DeepSeek 자동 재시도 (기본 2)
}

// ─── 라우팅 테이블 (V3 — DeepSeek 전면 전환) ──────────────────────────────────

const ROUTING: Record<LlmTask, RouteConfig> = {
  // 기존 태스크 (V3: DeepSeek primary, Gemini fallback)
  'extract-meta': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'card-news': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'summary': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'classify': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'judge': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 1,
  },

  // V2 태스크 (V3: DeepSeek 전환)
  'normalize-simple': {
    // parse_travel_doc — Flash executor + Pro advisor 1회 (2026-05-13 박제).
    // 정확도 100% 점근 목표 — 필수 필드 누락 시 Pro 로 escalate. 비용 ~2× but ROI 박힘.
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    advisor:  { provider: 'deepseek', model: MODELS.DEEPSEEK_PRO },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxAdvisorCalls: 1,
    maxRetries: 3,
  },
  'normalize-complex': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_PRO },
    advisor:  { provider: 'deepseek', model: MODELS.DEEPSEEK_PRO },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxAdvisorCalls: 1,
    maxRetries: 3,
  },
  'jarvis-simple': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'jarvis-complex': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_PRO },
    advisor:  { provider: 'deepseek', model: MODELS.DEEPSEEK_PRO },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxAdvisorCalls: 1,
    maxRetries: 2,
  },
  'cross-validate': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'blog-generate': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'content-brief': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'free-travel-extract': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'free-travel-itinerary': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'free-travel-compose': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'parse_travel_doc': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 3,
  },
  'qa-chat': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
  'response-critic': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 1,
  },
  'customer-fact-extract': {
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
    maxRetries: 2,
  },
};

// ─── 복잡도 자동 감지 ─────────────────────────────────────────────────────────

const COMPLEX_SIGNALS = [
  '환각', '할루시네이션', 'hallucin',
  '규칙', '조건', '예외', '모순',
  '검증', '감사', 'audit', 'validate',
  '플래닝', 'planning', '전략',
  '멀티스텝', 'multi-step',
];

/**
 * 0~1 복잡도 점수. 0.6 이상이면 complex 태스크로 에스컬레이션.
 */
export function estimateComplexity(prompt: string): number {
  let score = 0;
  const lower = prompt.toLowerCase();

  // 길이 기반 (3000자 이상이면 0.4 기여)
  score += Math.min(prompt.length / 7500, 0.4);

  // 키워드 신호 (최대 0.6 기여)
  const matched = COMPLEX_SIGNALS.filter(s => lower.includes(s)).length;
  score += Math.min(matched * 0.15, 0.6);

  return Math.min(score, 1);
}

/**
 * 복잡도 기반 자동 태스크 업그레이드.
 * normalize-simple → normalize-complex, jarvis-simple → jarvis-complex
 */
export function autoEscalateTask(task: LlmTask, prompt: string): LlmTask {
  const score = estimateComplexity(prompt);
  if (score >= 0.6) {
    if (task === 'normalize-simple') return 'normalize-complex';
    if (task === 'jarvis-simple') return 'jarvis-complex';
  }
  return task;
}

// ─── 파라미터 / 결과 타입 ─────────────────────────────────────────────────────

export interface GatewayCallParams {
  task: LlmTask;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  jsonSchema?: object;
  enableCaching?: boolean;
  autoEscalate?: boolean;  // true면 복잡도 감지 후 자동 task 업그레이드 (기본 true)
  /**
   * 2026-05-18 박제 (ERR-llm-retry-stack): 내부 executor 재시도 횟수 호출자 override.
   * ROUTING.maxRetries 보다 우선. 외부 layer (callWithZodValidation) 와 중첩 재시도하면
   * 최대 호출 = 외부 maxAttempts × (내부 maxRetries + 1) 이라 빠르게 폭주.
   * section-extractors 등 외부 재시도가 있는 경우 1 로 강제해서 총 호출 상한 유지.
   */
  maxRetries?: number;
  /**
   * Claude/Anthropic 호출에 한해 prompt cache TTL 을 1h 로 끌어올린다.
   * 기본 ephemeral 은 5분 — register Step 0~7 처럼 한 번의 등록이 5분 넘게 끌리거나
   * 동일 system prompt 로 batch 호출(여러 상품 연속 등록)할 때 cache miss 비용을 줄인다.
   * 1h cache write 는 2× 비용이지만 read 는 0.1× — 2회 이상 read 시 net 절감.
   * Anthropic 1h TTL 은 beta 기능: SDK 가 자동으로 anthropic-beta 헤더를 처리.
   */
  longCache?: boolean;
  /**
   * Confidence-gated escalation (Trust-or-Escalate, ICLR 2025).
   * 호출자가 executor 응답 데이터를 보고 "confidence 낮음" 이라 판단하면
   * advisor 모델(보통 더 강한 모델)로 재실행한다. 예시:
   *   escalateIfLowConfidence: (data) => (data?.confidence ?? 1) < 0.7
   *
   * 발동 조건:
   *   1) executor 가 success 를 반환했고
   *   2) route.advisor 가 정의된 task 이며
   *   3) 이 함수가 true 를 반환할 때
   *
   * advisor 실행이 실패하면 원래 primary 응답을 그대로 사용 (fail-soft).
   * 기존 "executor 실패 시 advisor 가 전략을 알려줌" 패턴과 별개로 동작:
   *   - 기존 advisor: 실패 → 전략 문자열 → executor 재실행
   *   - 신규 escalation: 성공+불확실 → advisor 가 직접 최종 응답 생성
   */
  escalateIfLowConfidence?: (data: unknown, rawText?: string) => boolean;
}

export interface GatewayResult<T = unknown> {
  success: boolean;
  data?: T;
  rawText?: string;
  provider?: 'deepseek' | 'gemini' | 'claude';
  model?: string;
  fallbackUsed?: boolean;
  advisorUsed?: boolean;
  complexityScore?: number;
  retryCount?: number;
  cacheHit?: boolean;
  errors?: string[];
  elapsed_ms?: number;
  /** 비용 추적용 토큰 수 (내부 전달용) */
  _usage?: { input: number; output: number; cache_hit: number };
}

// ─── 클라이언트 팩토리 ────────────────────────────────────────────────────────

function getDeepSeek(): OpenAI | null {
  const key = getProviderApiKey('deepseek');
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: 'https://api.deepseek.com',
    timeout: 60_000,
  });
}

function getGemini(): GoogleGenerativeAI | null {
  const key = getProviderApiKey('gemini');
  if (!key) return null;
  return new GoogleGenerativeAI(key);
}

function getClaude(): Anthropic | null {
  const key = getProviderApiKey('claude');
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// ─── DeepSeek 호출 (OpenAI 호환) ──────────────────────────────────────────────

async function callDeepSeek(
  client: OpenAI,
  model: string,
  params: GatewayCallParams,
  signal?: AbortSignal,
): Promise<GatewayResult> {
  const start = Date.now();
  try {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ];

    const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
      model,
      messages,
      max_tokens: params.maxTokens || 2000,
      temperature: params.temperature ?? 0.3,
      ...(params.jsonSchema ? { response_format: { type: 'json_object' as const } } : {}),
    };

    // signal 전달 — timeout 시 SDK 가 AbortError throw → 비용/span leak 방지
    const response = await client.chat.completions.create(requestParams, signal ? { signal } : undefined);
    const content = response.choices?.[0]?.message?.content || '';
    const usage = response.usage;

    // 캐시 히트 감지 (DeepSeek 프롬프트 캐싱 — OpenAI 표준 외 비표준 필드)
    const cacheHitTokens = (usage as DeepSeekUsageExtension | undefined)?.prompt_cache_hit_tokens ?? 0;
    const cacheHit = cacheHitTokens > 0;
    const _usage = {
      input: usage?.prompt_tokens ?? 0,
      output: usage?.completion_tokens ?? 0,
      cache_hit: cacheHitTokens,
    };

    if (params.jsonSchema) {
      try {
        const parsed = JSON.parse(content);
        return {
          success: true,
          data: parsed,
          provider: 'deepseek',
          model,
          cacheHit,
          _usage,
          elapsed_ms: Date.now() - start,
        };
      } catch {
        return {
          success: false,
          rawText: content,
          provider: 'deepseek',
          model,
          errors: [`JSON 파싱 실패: ${content.slice(0, 200)}`],
          elapsed_ms: Date.now() - start,
        };
      }
    }

    return {
      success: true,
      rawText: content,
      provider: 'deepseek',
      model,
      cacheHit,
      _usage,
      elapsed_ms: Date.now() - start,
    };
  } catch (e) {
    return {
      success: false,
      provider: 'deepseek',
      model,
      errors: [e instanceof Error ? e.message : String(e)],
      elapsed_ms: Date.now() - start,
    };
  }
}

// ─── Gemini 호출 (fallback 전용) ──────────────────────────────────────────────

async function callGemini(
  client: GoogleGenerativeAI,
  modelName: string,
  params: GatewayCallParams,
): Promise<GatewayResult> {
  const start = Date.now();
  try {
    const model = client.getGenerativeModel({
      model: modelName,
      systemInstruction: params.systemPrompt,
      generationConfig: {
        responseMimeType: params.jsonSchema ? 'application/json' : 'text/plain',
        temperature: params.temperature ?? 0.3,
        maxOutputTokens: params.maxTokens ? Math.max(params.maxTokens, 16384) : 4096,
        // jsonSchema 가 GoogleGenerativeAI ResponseSchema 와 구조 호환 (zod-to-gemini-schema 변환됨)
        ...(params.jsonSchema ? { responseSchema: params.jsonSchema as ResponseSchema } : {}),
      },
    });
    const res = await model.generateContent(params.userPrompt);
    const txt = res.response.text();
    const meta = res.response.usageMetadata;
    const _usage = {
      input: meta?.promptTokenCount ?? 0,
      output: meta?.candidatesTokenCount ?? 0,
      cache_hit: meta?.cachedContentTokenCount ?? 0,
    };
    return {
      success: true,
      data: params.jsonSchema ? JSON.parse(txt) : undefined,
      rawText: params.jsonSchema ? undefined : txt,
      provider: 'gemini',
      model: modelName,
      _usage,
      elapsed_ms: Date.now() - start,
    };
  } catch (e) {
    return { success: false, provider: 'gemini', model: modelName, errors: [e instanceof Error ? e.message : String(e)], elapsed_ms: Date.now() - start };
  }
}

async function callClaude(
  client: Anthropic,
  model: string,
  params: GatewayCallParams,
  signal?: AbortSignal,
): Promise<GatewayResult> {
  const start = Date.now();
  try {
    // 1h TTL opt-in (params.longCache=true). 기본은 5min ephemeral.
    // SDK 타입이 ttl 을 직접 지원하지 않을 수 있어 as 캐스팅 — 런타임은 그대로 통과.
    const cacheControl = params.longCache
      ? ({ type: 'ephemeral', ttl: '1h' } as unknown as { type: 'ephemeral' })
      : ({ type: 'ephemeral' } as const);
    // signal 전달 — timeout 시 Anthropic SDK 가 AbortError throw
    const response = await client.messages.create(
      {
        model,
        system: params.systemPrompt
          ? [{ type: 'text' as const, text: params.systemPrompt, cache_control: cacheControl }]
          : undefined,
        max_tokens: params.maxTokens || 2000,
        temperature: params.temperature ?? 0.3,
        messages: [{ role: 'user', content: params.userPrompt }],
      },
      signal ? { signal } : undefined,
    );

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as Anthropic.TextBlock).text)
      .join('\n');

    const usage = response.usage;
    const _usage = {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cache_hit: usage.cache_read_input_tokens ?? 0,
    };

    if (params.jsonSchema) {
      try {
        return {
          success: true,
          data: JSON.parse(text),
          provider: 'claude',
          model,
          _usage,
          elapsed_ms: Date.now() - start,
        };
      } catch {
        return {
          success: false,
          rawText: text,
          provider: 'claude',
          model,
          errors: [`JSON 파싱 실패: ${text.slice(0, 200)}`],
          elapsed_ms: Date.now() - start,
        };
      }
    }

    return {
      success: true,
      rawText: text,
      provider: 'claude',
      model,
      _usage,
      elapsed_ms: Date.now() - start,
    };
  } catch (e) {
    return {
      success: false,
      provider: 'claude',
      model,
      errors: [e instanceof Error ? e.message : String(e)],
      elapsed_ms: Date.now() - start,
    };
  }
}

// ─── 단건 호출 헬퍼 ──────────────────────────────────────────────────────────

async function callModel(
  ref: ModelRef,
  params: GatewayCallParams,
  signal?: AbortSignal,
): Promise<GatewayResult> {
  // OTel span — Vercel OTel collector 또는 OTLP endpoint 로 전송 (미설정 시 no-op)
  return traceLlmCall(
    { task: params.task, provider: ref.provider, model: ref.model },
    async (span) => {
      let result: GatewayResult;
      if (ref.provider === 'deepseek') {
        const client = getDeepSeek();
        if (!client) return { success: false, errors: ['DEEPSEEK_API_KEY 없음'] };
        result = await callDeepSeek(client, ref.model, params, signal);
      } else if (ref.provider === 'gemini') {
        const client = getGemini();
        if (!client) return { success: false, errors: ['Gemini API 키 없음'] };
        // Gemini SDK 는 signal 직접 지원 X — 타임아웃 시 race 만으로 처리
        result = await callGemini(client, ref.model, params);
      } else {
        const client = getClaude();
        if (!client) return { success: false, errors: ['ANTHROPIC_API_KEY 없음'] };
        result = await callClaude(client, ref.model, params, signal);
      }
      // span 에 usage 기록 (성공·실패 모두)
      if (result._usage) {
        recordLlmUsage(span, {
          input: result._usage.input,
          output: result._usage.output,
          cache_hit: result._usage.cache_hit,
          latency_ms: result.elapsed_ms,
        });
      }
      span.setAttribute('llm.success', result.success);
      return result;
    },
  );
}

async function callModelWithTimeout(
  ref: ModelRef,
  params: GatewayCallParams,
  timeoutMs?: number | null,
): Promise<GatewayResult> {
  if (!timeoutMs || timeoutMs <= 0) return callModel(ref, params);

  // C-2 코드리뷰 fix: AbortController 로 race 후 inflight SDK 호출 cancel.
  //   기존 Promise.race 만 사용하던 방식은 timeout 분기가 결정되어도 callModel 내부의
  //   SDK 호출이 계속 실행 → span/cost/network 누수.
  //   race 승자 결정 후 finally 에서 abort → 성공 시 no-op, timeout 시 inflight cancel.
  //
  //   Gemini SDK 는 v0.24 시점 signal 직접 지원 X — fetch 레벨 race 한정.
  const ac = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      callModel(ref, params, ac.signal),
      new Promise<GatewayResult>((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({
            success: false,
            provider: ref.provider,
            model: ref.model,
            errors: [`timeout(${timeoutMs}ms)`],
          });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    // race 승자 무관: timeout 이면 inflight SDK cancel, 성공이면 no-op
    if (!ac.signal.aborted) ac.abort();
  }
}

// ─── Advisor 단일 호출 ────────────────────────────────────────────────────────

/**
 * Advisor 패턴: executor 가 막혔을 때 고성능 모델에게 전략만 물어보고,
 * 그 조언을 executor 의 다음 프롬프트에 주입한다.
 * advisor 는 절대 최종 결과를 생성하지 않는다 — 방향만 제시.
 */
async function consultAdvisor(
  advisor: ModelRef,
  originalParams: GatewayCallParams,
  executorError: string,
): Promise<string | null> {
  const advisorParams: GatewayCallParams = {
    task: 'judge',
    systemPrompt: '당신은 AI 작업 전략 고문입니다. 실행 모델이 막혔을 때 어떤 접근으로 해결해야 하는지 한국어로 간결하게(200자 이내) 지시만 해주세요. 실제 답변은 실행 모델이 합니다.',
    userPrompt: `[원래 작업]\n${originalParams.systemPrompt}\n\n[요청]\n${originalParams.userPrompt.slice(0, 500)}\n\n[실행 모델 오류]\n${executorError}\n\n→ 어떻게 접근하면 되겠습니까? 단계별로 짧게 알려주세요.`,
    maxTokens: 400,
    temperature: 0.1,
    enableCaching: false,
  };
  const result = await callModel(advisor, advisorParams);
  return result.success ? (result.rawText ?? null) : null;
}

// ─── 메인 export ──────────────────────────────────────────────────────────────

/**
 * 통합 LLM 호출 (V3 — DeepSeek 전면 전환).
 *
 * 호출 순서:
 *   1. DeepSeek executor (최대 maxRetries 재시도)
 *   2. DeepSeek advisor (실패 시 + advisor 설정 있을 때)
 *   3. Gemini Flash fallback (최종 안전망)
 *
 * 기존 코드와 100% 하위호환:
 *   const r = await llmCall({ task: 'extract-meta', systemPrompt, userPrompt });
 */
export async function llmCall<T = unknown>(params: GatewayCallParams): Promise<GatewayResult<T>> {
  const autoEscalate = params.autoEscalate !== false;
  const effectiveTask = autoEscalate
    ? autoEscalateTask(params.task, params.userPrompt)
    : params.task;

  const complexityScore = estimateComplexity(params.userPrompt);
  const route = ROUTING[effectiveTask];
  const policy = await resolveAiPolicyRuntime(
    effectiveTask,
    route.executor.model.includes('pro') ? 'pro' : 'fast',
  );
  const executor: ModelRef = { provider: policy.provider, model: policy.model };
  const fallback: ModelRef | null = policy.fallbackProvider
    ? { provider: policy.fallbackProvider, model: policy.fallbackModel || route.fallback?.model || route.executor.model }
    : route.fallback;
  const envTimeout = Number(process.env.AI_EXECUTOR_TIMEOUT_MS || 0);
  const timeoutMs = policy.timeoutMs ?? (envTimeout > 0 ? envTimeout : null);
  const errors: string[] = [];
  // 호출자 override (params.maxRetries) > ROUTING 기본 (route.maxRetries) > fallback 2
  const maxRetries = params.maxRetries ?? route.maxRetries ?? 2;

  // ─── 비용 기록 헬퍼 (fail-open) ────────────────────────────────────────────
  function recordCost(result: GatewayResult, model: string, provider: 'deepseek' | 'gemini' | 'claude') {
    if (!result._usage) return;
    const { input, output, cache_hit } = result._usage;
    if (provider === 'deepseek') {
      void trackDeepSeekCost({
        task: effectiveTask,
        model,
        usage: { prompt_tokens: input, completion_tokens: output, prompt_cache_hit_tokens: cache_hit },
        latencyMs: result.elapsed_ms,
      });
    } else {
      void trackCost({
        ctx: { userRole: 'platform_admin' },
        agentType: effectiveTask,
        model,
        usage: {
          promptTokenCount: input,
          candidatesTokenCount: output,
          cachedContentTokenCount: cache_hit,
        },
        latencyMs: result.elapsed_ms,
      });
    }
  }

  // 1차~N차: executor 재시도 (DeepSeek는 저렴하므로 재시도 부담 없음)
  const skipExecutor = !getProviderApiKey(executor.provider)?.trim();
  if (skipExecutor) {
    errors.push(`[executor skipped] ${executor.provider} API 키 빈 값 또는 미설정`);
    console.warn(`[llm-gateway] ${executor.provider} executor 스킵 → 즉시 fallback (task=${effectiveTask})`);
  } else {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const primary = await callModelWithTimeout(executor, params, timeoutMs);
      if (primary.success) {
        recordCost(primary, executor.model, executor.provider);

        // Confidence-gated escalation (Trust-or-Escalate, ICLR 2025).
        // 호출자가 응답 데이터를 보고 "확신 부족" 으로 판단하면 advisor 모델로 재실행.
        if (route.advisor && params.escalateIfLowConfidence) {
          let lowConf = false;
          try {
            lowConf = !!params.escalateIfLowConfidence(primary.data, primary.rawText);
          } catch (e) {
            console.warn(`[llm-gateway] confidence predicate threw: ${e instanceof Error ? e.message : String(e)}`);
          }
          if (lowConf) {
            console.log(`[llm-gateway] confidence-gated escalation: ${executor.provider}/${executor.model} → ${route.advisor.provider}/${route.advisor.model} (task=${effectiveTask})`);
            const escalated = await callModelWithTimeout(route.advisor, params, timeoutMs);
            if (escalated.success) {
              recordCost(escalated, route.advisor.model, route.advisor.provider);
              return {
                ...escalated,
                advisorUsed: true,
                complexityScore,
                retryCount: attempt,
              } as GatewayResult<T>;
            }
            console.warn(`[llm-gateway] confidence escalation 실패 → primary 응답 유지 (${escalated.errors?.join(',') ?? 'unknown'})`);
          }
        }

        return { ...primary, complexityScore, retryCount: attempt } as GatewayResult<T>;
      }
      errors.push(`[executor attempt ${attempt + 1}/${maxRetries + 1} ${executor.provider}/${executor.model}] ${primary.errors?.join(',') ?? 'unknown'}`);

      // 2회 이상 실패하고 advisor 있으면 조언 구해서 재시도
      if (attempt >= 1 && route.advisor) {
        const advice = await consultAdvisor(route.advisor, params, errors[errors.length - 1]);
        if (advice) {
          const enhancedParams: GatewayCallParams = {
            ...params,
            systemPrompt: `${params.systemPrompt}\n\n[전략 가이드]\n${advice}`,
          };
          const retried = await callModelWithTimeout(executor, enhancedParams, timeoutMs);
          if (retried.success) {
            recordCost(retried, executor.model, executor.provider);
            return { ...retried, advisorUsed: true, complexityScore, retryCount: attempt + 1 } as GatewayResult<T>;
          }
          errors.push(`[executor+advisor retry] ${retried.errors?.join(',') ?? 'unknown'}`);
        }
      }
    }
  }

  // 최종: Gemini fallback
  if (fallback) {
    console.warn(`[llm-gateway fallback] ${executor.provider}→${fallback.provider} (task=${effectiveTask})`);
    const fb = await callModel(fallback, params);
    if (fb.success) {
      recordCost(fb, fallback.model, fallback.provider);
      return { ...fb, fallbackUsed: true, complexityScore } as GatewayResult<T>;
    }
    errors.push(`[fallback ${fallback.provider}/${fallback.model}] ${fb.errors?.join(',') ?? 'unknown'}`);
  }

  return { success: false, errors, complexityScore };
}

/**
 * 라우팅 정보 노출 — 디버깅/대시보드용
 */
export function getRouteInfo(task: LlmTask) {
  return ROUTING[task];
}

/**
 * 모든 task 타입과 현재 라우팅 요약 — 어드민 AI 설정 페이지용
 */
export function getAllRoutes(): Record<LlmTask, { executor: string; advisor?: string; fallback?: string }> {
  return Object.fromEntries(
    Object.entries(ROUTING).map(([task, r]) => [
      task,
      {
        executor: (() => {
          const p = resolveAiPolicy(task, r.executor.model.includes('pro') ? 'pro' : 'fast');
          return `${p.provider}/${p.model}`;
        })(),
        ...(r.advisor ? { advisor: `${r.advisor.provider}/${r.advisor.model}` } : {}),
        ...(r.fallback ? { fallback: `${r.fallback.provider}/${r.fallback.model}` } : {}),
      },
    ]),
  ) as Record<LlmTask, { executor: string; advisor?: string; fallback?: string }>;
}

// ─── 스트리밍 (DeepSeek 전용) — QA TTFT 개선 ─────────────────────────────────

/**
 * 부분 JSON 버퍼에서 "reply" 문자열 값의 현재까지 파싱 가능한 접두를 반환.
 * 스트리밍 중에도 고객에게 본문을 먼저 보여주기 위함.
 */
export function extractPartialReplyFromJsonObject(accumulated: string): string | null {
  const m = accumulated.match(/"reply"\s*:\s*"/);
  if (!m || m.index === undefined) return null;
  let i = m.index + m[0].length;
  let out = '';
  while (i < accumulated.length) {
    const c = accumulated[i];
    if (c === '\\') {
      i++;
      if (i >= accumulated.length) break;
      const esc = accumulated[i];
      if (esc === 'n') out += '\n';
      else if (esc === 't') out += '\t';
      else if (esc === 'r') out += '\r';
      else out += esc;
      i++;
      continue;
    }
    if (c === '"') return out;
    out += c;
    i++;
  }
  return out;
}

type StreamDeltaHandler = (info: { accumulated: string; replyVisible: string | null }) => void;

async function callDeepSeekStream(
  client: OpenAI,
  model: string,
  params: GatewayCallParams,
  onDelta: StreamDeltaHandler,
): Promise<GatewayResult> {
  const start = Date.now();
  try {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ];

    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model,
      messages,
      max_tokens: params.maxTokens || 2000,
      temperature: params.temperature ?? 0.3,
      stream: true,
      ...(params.jsonSchema ? { response_format: { type: 'json_object' as const } } : {}),
    };

    const stream = await client.chat.completions.create(requestParams);
    let acc = '';
    let usage: OpenAI.Chat.Completions.ChatCompletion['usage'] | undefined;
    for await (const chunk of stream) {
      const piece = chunk.choices[0]?.delta?.content ?? '';
      if (piece) {
        acc += piece;
        onDelta({
          accumulated: acc,
          replyVisible: extractPartialReplyFromJsonObject(acc),
        });
      }
      if (chunk.usage) usage = chunk.usage;
    }

    const cacheHitTokens = (usage as { prompt_cache_hit_tokens?: number } | undefined)?.prompt_cache_hit_tokens ?? 0;
    const cacheHit = cacheHitTokens > 0;
    const _usage = {
      input: usage?.prompt_tokens ?? 0,
      output: usage?.completion_tokens ?? 0,
      cache_hit: cacheHitTokens,
    };
    const content = acc;

    if (params.jsonSchema) {
      try {
        const parsed = JSON.parse(content);
        return {
          success: true,
          data: parsed,
          provider: 'deepseek',
          model,
          cacheHit,
          _usage,
          elapsed_ms: Date.now() - start,
        };
      } catch {
        return {
          success: false,
          rawText: content,
          provider: 'deepseek',
          model,
          errors: [`JSON 파싱 실패: ${content.slice(0, 200)}`],
          elapsed_ms: Date.now() - start,
        };
      }
    }

    return {
      success: true,
      rawText: content,
      provider: 'deepseek',
      model,
      cacheHit,
      _usage,
      elapsed_ms: Date.now() - start,
    };
  } catch (e) {
    return {
      success: false,
      provider: 'deepseek',
      model,
      errors: [e instanceof Error ? e.message : String(e)],
      elapsed_ms: Date.now() - start,
    };
  }
}

/**
 * DeepSeek 스트리밍 1회 시도 (TTFT). 실패 시 호출부에서 llmCall 폴백.
 */
export async function tryDeepSeekStream(
  params: GatewayCallParams,
  onDelta: StreamDeltaHandler,
): Promise<GatewayResult<string>> {
  const autoEscalate = params.autoEscalate !== false;
  const effectiveTask = autoEscalate
    ? autoEscalateTask(params.task, params.userPrompt)
    : params.task;
  const route = ROUTING[effectiveTask];
  const client = getDeepSeek();
  if (!client || !getSecret('DEEPSEEK_API_KEY')) {
    return { success: false, errors: ['DEEPSEEK_API_KEY 없음'] };
  }
  if (route.executor.provider !== 'deepseek') {
    return { success: false, errors: ['스트리밍은 DeepSeek executor만 지원'] };
  }
  const result = await callDeepSeekStream(client, route.executor.model, params, onDelta);
  if (result.success && result._usage) {
    void trackDeepSeekCost({
      task: effectiveTask,
      model: route.executor.model,
      usage: {
        prompt_tokens: result._usage.input,
        completion_tokens: result._usage.output,
        prompt_cache_hit_tokens: result._usage.cache_hit,
      },
      latencyMs: result.elapsed_ms,
    });
  }
  return result as GatewayResult<string>;
}
