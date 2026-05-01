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
import { GoogleGenerativeAI } from '@google/generative-ai';

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
  | 'free-travel-compose'; // Flash (자유여행 일정 코멘트 생성)

interface ModelRef {
  provider: 'deepseek' | 'gemini';
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
    executor: { provider: 'deepseek', model: MODELS.DEEPSEEK_FLASH },
    fallback: { provider: 'gemini', model: MODELS.GEMINI_FLASH },
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
  'free-travel-compose': {
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
}

export interface GatewayResult<T = unknown> {
  success: boolean;
  data?: T;
  rawText?: string;
  provider?: 'deepseek' | 'gemini';
  model?: string;
  fallbackUsed?: boolean;
  advisorUsed?: boolean;    // V2: advisor 호출 여부
  complexityScore?: number; // V2: 복잡도 점수
  retryCount?: number;      // V3: 재시도 횟수
  cacheHit?: boolean;
  errors?: string[];
  elapsed_ms?: number;
}

// ─── 클라이언트 팩토리 ────────────────────────────────────────────────────────

function getDeepSeek(): OpenAI | null {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: 'https://api.deepseek.com',
  });
}

function getGemini(): GoogleGenerativeAI | null {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!key) return null;
  return new GoogleGenerativeAI(key);
}

// ─── DeepSeek 호출 (OpenAI 호환) ──────────────────────────────────────────────

async function callDeepSeek(
  client: OpenAI,
  model: string,
  params: GatewayCallParams,
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

    const response = await client.chat.completions.create(requestParams);
    const content = response.choices?.[0]?.message?.content || '';
    const usage = response.usage;

    // 캐시 히트 감지 (DeepSeek 프롬프트 캐싱)
    const cacheHit = (usage as any)?.prompt_cache_hit_tokens > 0;

    if (params.jsonSchema) {
      try {
        const parsed = JSON.parse(content);
        return {
          success: true,
          data: parsed,
          provider: 'deepseek',
          model,
          cacheHit,
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
        maxOutputTokens: params.maxTokens || 2000,
        ...(params.jsonSchema ? { responseSchema: params.jsonSchema as any } : {}),
      },
    });
    const res = await model.generateContent(params.userPrompt);
    const txt = res.response.text();
    return {
      success: true,
      data: params.jsonSchema ? JSON.parse(txt) : undefined,
      rawText: params.jsonSchema ? undefined : txt,
      provider: 'gemini',
      model: modelName,
      elapsed_ms: Date.now() - start,
    };
  } catch (e) {
    return { success: false, provider: 'gemini', model: modelName, errors: [e instanceof Error ? e.message : String(e)], elapsed_ms: Date.now() - start };
  }
}

// ─── 단건 호출 헬퍼 ──────────────────────────────────────────────────────────

async function callModel(ref: ModelRef, params: GatewayCallParams): Promise<GatewayResult> {
  if (ref.provider === 'deepseek') {
    const client = getDeepSeek();
    if (!client) return { success: false, errors: ['DEEPSEEK_API_KEY 없음'] };
    return callDeepSeek(client, ref.model, params);
  }
  // gemini fallback
  const client = getGemini();
  if (!client) return { success: false, errors: ['Gemini API 키 없음'] };
  return callGemini(client, ref.model, params);
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
  const errors: string[] = [];
  const maxRetries = route.maxRetries ?? 2;

  // 1차~N차: executor 재시도 (DeepSeek는 저렴하므로 재시도 부담 없음)
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const primary = await callModel(route.executor, params);
    if (primary.success) {
      return { ...primary, complexityScore, retryCount: attempt } as GatewayResult<T>;
    }
    errors.push(`[executor attempt ${attempt + 1}/${maxRetries + 1} ${route.executor.provider}/${route.executor.model}] ${primary.errors?.join(',') ?? 'unknown'}`);

    // 2회 이상 실패하고 advisor 있으면 조언 구해서 재시도
    if (attempt >= 1 && route.advisor) {
      const advice = await consultAdvisor(route.advisor, params, errors[errors.length - 1]);
      if (advice) {
        const enhancedParams: GatewayCallParams = {
          ...params,
          systemPrompt: `${params.systemPrompt}\n\n[전략 가이드]\n${advice}`,
        };
        const retried = await callModel(route.executor, enhancedParams);
        if (retried.success) {
          return { ...retried, advisorUsed: true, complexityScore, retryCount: attempt + 1 } as GatewayResult<T>;
        }
        errors.push(`[executor+advisor retry] ${retried.errors?.join(',') ?? 'unknown'}`);
      }
    }
  }

  // 최종: Gemini fallback
  if (route.fallback) {
    console.warn(`[llm-gateway fallback] ${route.executor.provider}→${route.fallback.provider} (task=${effectiveTask})`);
    const fb = await callModel(route.fallback, params);
    if (fb.success) {
      return { ...fb, fallbackUsed: true, complexityScore } as GatewayResult<T>;
    }
    errors.push(`[fallback ${route.fallback.provider}/${route.fallback.model}] ${fb.errors?.join(',') ?? 'unknown'}`);
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
        executor: `${r.executor.provider}/${r.executor.model}`,
        ...(r.advisor ? { advisor: `${r.advisor.provider}/${r.advisor.model}` } : {}),
        ...(r.fallback ? { fallback: `${r.fallback.provider}/${r.fallback.model}` } : {}),
      },
    ]),
  ) as any;
}
