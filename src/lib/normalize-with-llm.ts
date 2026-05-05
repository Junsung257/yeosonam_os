/**
 * @file normalize-with-llm.ts — Phase 1.5 L1 LLM Normalizer (V3 — DeepSeek 전면 전환)
 *
 * 원문 텍스트 → NormalizedIntake (IR) 변환.
 *
 * V3 변경 (2026-05-01):
 *   - 기본 엔진: DeepSeek V4-Pro (OpenAI 호환 API)
 *   - fallback: Gemini 2.5 Flash (기존 유지)
 *   - Claude 엔진: 레거시 유지 (engine='claude' 명시 시만)
 *   - DeepSeek는 response_format: json_object + Zod 검증
 *
 * 보호 장치:
 *   1. Zod 스키마 강제 (NormalizedIntakeSchema)
 *   2. rawText 원본 보존 + rawTextHash sha256
 *   3. min_participants 원문 N명 이상 1:1 강제
 *   4. inclusions 콤마 없는 단일 토큰 (W26)
 *   5. 하루 최대 1 flight (W27)
 *   6. regions 원문 "지역" 컬럼 1:1 (ERR-FUK-regions-copy)
 *
 * 비용: ~0.005~0.01 USD/건 (DeepSeek V4-Pro, 원문 3000자 기준)
 */

import crypto from 'crypto';
import OpenAI from 'openai';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import {
  NormalizedIntakeSchema,
  validateIntake,
  NORMALIZER_VERSION,
  type NormalizedIntake,
} from './intake-normalizer';
import { zodToGeminiSchema } from './llm-structured-output';
import { retrieveSimilarExamples, buildFewShotPromptFragment, type SimilarExample } from './few-shot-retriever';
import { getRelevantReflections, buildReflectionPromptFragment, trackReflectionApplied } from './reflection-memory';
import { createClient } from '@supabase/supabase-js';
import { getPrompt } from './prompt-loader';

const SYSTEM_PROMPT_FALLBACK = `당신은 여행 상품 원문을 구조화된 IR(Intermediate Representation) 로 변환하는 전문 정형화 Agent 입니다.

## 절대 규칙 (위반 시 INSERT 차단)

### R1. 원문 보존 (Rule Zero)
- rawText 는 입력 원문을 **글자 하나 변형 없이** 그대로 유지
- rawTextHash 는 sha256(rawText) 를 그대로 사용
- 파싱 결과는 "요약·정규화" 가 아닌 "구조적 분해"

### R2. 숫자는 1:1 매핑 (템플릿 기본값 금지)
- "최소 출발 10명" → minParticipants: 10 (4 아님)
- "2명부터 출발" → minParticipants: 2
- 원문에 숫자 명시 없으면 문맥상 가장 흔한 값(4) 사용, 단 반드시 노트에 명시

### R3. 발권기한 정확 매핑
- 원문에 "발권/예약 마감/티켓팅" 키워드가 있어야 ticketingDeadline 설정
- 단순 버전일·배포일 (예: "2026.04.01") 은 ticketingDeadline 으로 해석 금지 (null)

### R4. inclusions 는 개별 단일 토큰
- ❌ "항공료, 택스, 유류세" (콤마 묶음)
- ✅ ["항공료","택스","유류세"] (3개 개별)

### R5. 하루 최대 1 flight
- days[].flight 는 단일 객체 또는 null
- "BX3615 부산 출발" + "BX3615 황산 도착" 을 별개 flight 로 분리 금지
- 경유편은 root.flights.outbound 배열로

### R6. regions 원문 "지역" 컬럼 1:1
- 원문 일정표의 "지역" 셀을 그대로 배열로
- 제1일 "부산/황산" → ["부산","황산"]
- 여러 상품(3박4일+4박5일 등)이 한 원문에 있을 때 서로 복사 금지

### R7. 금액 주입 절대 금지
- 원문 "여행자보험" → inclusions: ["여행자보험"] (그대로)
- ❌ "2억 여행자보험" 같이 원문 없는 금액 추가 금지

### R8. 7-kind segment 분류 규칙
각 일정 항목을 7가지 kind 중 하나로 분류:
- **attraction**: ▶로 시작하는 관광지 / 장소명 (호텔·공항 제외)
  - & 로 묶인 경우 attractionNames 배열에 개별 분리: "유성폭포&은하폭포" → ["유성폭포","은하폭포"]
  - 원문 수식 문구는 rawDescription 에 보존 (예: "뾰족하게 솟은 바위의 양쪽으로 떨어지는")
- **transit**: "X 이동 (약 N분 소요)" 형태 → to: "X", durationText: "약 N분 소요"
- **note**: ** 또는 ※ 로 시작하는 부대 설명 → text 에 그대로 + attachedToIndex 로 앞 attraction 연결
- **special**: ♡ ♦ ★ 등 특전 마커 → text 에 내용, icon 에 마커
- **meal**: 호텔 조식·외부 석식 등 식사 안내 (day.meals 는 summary, 이건 위치 기반 텍스트)
- **hotel-check**: "호텔 체크인 및 휴식" / "호텔 투숙 및 휴식" 등
- **misc**: 위 6가지에 명확히 속하지 않는 것 (추후 학습)

### R9. attachedToIndex
- 부대 설명 (note) 의 attachedToIndex 는 같은 day.segments 배열 기준 직전 attraction index

### R10. 출발요일 평문
- departureDays 는 "화", "월/수/금" 같은 한글 평문
- ❌ ["금"] JSON 배열 문자열

## 출력
반드시 NormalizedIntake JSON 스키마를 완벽히 준수하는 JSON 객체를 반환하세요.
rawText, rawTextHash, normalizerVersion, extractedAt 필드는 시스템이 자동 주입하므로 생략해도 됩니다.`;

export interface NormalizerInput {
  rawText: string;
  landOperator: string;
  commissionRate: number;
  hintRegion?: string;
  hintCountry?: string;
}

export interface NormalizerResult {
  success: boolean;
  ir?: NormalizedIntake;
  errors?: string[];
  rawLlmResponse?: unknown;
  tokensUsed?: { input: number; output: number };
  retryCount?: number;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function getDeepSeekClient(): OpenAI {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY 누락 — .env.local 확인');
  return new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' });
}

function getGeminiClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 누락 — .env.local 확인');
  return new GoogleGenerativeAI(key);
}

/**
 * 원문을 IR 로 정형화.
 *
 * @param input  원문 + 랜드사 + 마진율 + (옵션) 지역/국가 힌트
 * @param options engine('deepseek'|'gemini'|'claude'), 재시도, 모델 선택
 */
export async function normalizeWithLlm(
  input: NormalizerInput,
  options: {
    engine?: 'deepseek' | 'gemini' | 'claude';
    model?: string;
    maxRetries?: number;
    fewShotEnabled?: boolean;          // EPR (Rubin et al. 2022) — 기본 ON
    fewShotLimit?: number;
    reflectionEnabled?: boolean;        // Reflexion (Shinn et al. 2023) — 기본 ON
    reflectionLimit?: number;
    landOperatorId?: string;            // reflection 매칭용
  } = {},
): Promise<NormalizerResult> {
  const { engine = 'deepseek', maxRetries = 3, fewShotEnabled = true, fewShotLimit = 4, reflectionEnabled = true, reflectionLimit = 6 } = options;

  // ── Supabase client (EPR + Reflexion 공유) ─
  let sb: ReturnType<typeof createClient> | null = null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (supabaseUrl && supabaseKey) {
    sb = createClient(supabaseUrl, supabaseKey);
  }

  // ── EPR + Reflexion 병렬 조회 (독립적 쿼리이므로 Promise.all로 동시 실행) ─
  let fewShotFragment = '';
  let fewShotCount = 0;
  let reflectionFragment = '';
  let reflectionIds: string[] = [];

  const [eprResult, reflexionResult] = await Promise.all([
    (fewShotEnabled && sb && geminiKey)
      ? retrieveSimilarExamples(input.rawText, sb as any, geminiKey, {
          limit: fewShotLimit,
          minSimilarity: 0.55,
        }).catch((e: unknown) => {
          console.warn('[normalize-with-llm EPR] retrieval 실패 (폴백: few-shot 없이 진행):', e instanceof Error ? e.message : e);
          return [];
        })
      : Promise.resolve([]),
    (reflectionEnabled && sb)
      ? getRelevantReflections(sb, {
          landOperatorId: options.landOperatorId,
          destination: input.hintRegion,
          limit: reflectionLimit,
          minSeverity: 'medium',
        }).catch((e: unknown) => {
          console.warn('[normalize-with-llm Reflexion] retrieval 실패:', e instanceof Error ? e.message : e);
          return [];
        })
      : Promise.resolve([]),
  ]);

  if (eprResult.length > 0) {
    fewShotFragment = buildFewShotPromptFragment(eprResult);
    fewShotCount = eprResult.length;
  }
  if (reflexionResult.length > 0) {
    reflectionFragment = buildReflectionPromptFragment(reflexionResult);
    reflectionIds = reflexionResult.map((r: { id: string }) => r.id);
  }

  const buildUserMessage = () => [
    reflectionFragment, // Reflexion (회피 패턴) — 가장 강한 우선순위로 prompt 시작에
    fewShotFragment,    // EPR demo (성공 사례)
    `## 랜드사: ${input.landOperator}`,
    `## 마진율: ${input.commissionRate}%`,
    input.hintRegion ? `## 지역 힌트: ${input.hintRegion}` : '',
    input.hintCountry ? `## 국가 힌트: ${input.hintCountry}` : '',
    '',
    '## 원문',
    input.rawText,
    '',
    '위 원문을 NormalizedIntake 로 정형화하세요.',
    fewShotCount > 0 ? '⚠️ 위 "유사 등록 사례"는 패턴 참고용입니다. 사실 추출은 반드시 **이번 원문**에만 근거.' : '',
    reflectionIds.length > 0 ? '🚨 위 "과거 정정 사례"의 실수를 절대 반복하지 마세요.' : '',
  ].filter(Boolean).join('\n');

  const userMessage = buildUserMessage();

  // ── 1차 호출 (DeepSeek 기본, Gemini/Claude 선택 가능) ─
  let result: NormalizerResult;
  if (engine === 'gemini') {
    result = await runGemini(input, { maxRetries, userMessage, model: options.model || 'gemini-2.5-flash' });
  } else if (engine === 'claude') {
    // 레거시 Claude 엔진 — 필요 시 명시적으로만 사용
    console.warn('[normalize-with-llm] Claude 엔진 사용 — 비용 주의');
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const { zodToClaudeSchema } = await import('./llm-structured-output');
    result = await runClaudeLegacy(input, { maxRetries, userMessage, model: options.model || 'claude-sonnet-4-6' }, Anthropic, zodToClaudeSchema);
  } else {
    // DeepSeek V4 (기본 엔진)
    result = await runDeepSeek(input, { maxRetries, userMessage, model: options.model || 'deepseek-v4-pro' });
  }

  // ── AI Gateway fallback — DeepSeek 실패 시 Gemini Flash 시도 ─
  if (!result.success && engine === 'deepseek') {
    console.warn('[normalize-with-llm fallback] DeepSeek 실패 → Gemini 2.5 Flash 폴백 시도');
    const fallbackResult = await runGemini(input, {
      maxRetries: 1,
      userMessage,
      model: 'gemini-2.5-flash',
    });
    if (fallbackResult.success) {
      console.log('[normalize-with-llm fallback] Gemini 폴백 성공');
      result = { ...fallbackResult, retryCount: (fallbackResult.retryCount || 0) + (result.retryCount || 0) };
    }
  }

  // Reflexion applied_count 증가 (성공 시만)
  if (result.success && sb && reflectionIds.length > 0) {
    trackReflectionApplied(sb, reflectionIds).catch(() => {});
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DeepSeek 엔진 (OpenAI 호환 API, JSON mode + Zod 검증)
// ═══════════════════════════════════════════════════════════════════════════

async function runDeepSeek(
  input: NormalizerInput,
  opts: { maxRetries: number; userMessage: string; model: string },
): Promise<NormalizerResult> {
  const client = getDeepSeekClient();
  const systemPrompt = await getPrompt('normalize-system', SYSTEM_PROMPT_FALLBACK);
  let lastErrors: string[] = [];
  let feedback: string | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const prompt = feedback
        ? `${opts.userMessage}\n\n## 이전 시도 Zod 검증 오류 (반드시 수정하여 재출력):\n${feedback}`
        : opts.userMessage;

      const response = await client.chat.completions.create({
        model: opts.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 8192,
        temperature: 0.1,
      });

      const content = response.choices?.[0]?.message?.content || '';
      const usage = response.usage;

      // 캐시 히트 로깅
      const cacheHitTokens = (usage as any)?.prompt_cache_hit_tokens ?? 0;
      if (cacheHitTokens > 0) {
        console.log(`[normalize-with-llm deepseek cache] hit=${cacheHitTokens} tokens`);
      }

      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(content);
      } catch {
        lastErrors = ['DeepSeek 응답이 유효한 JSON 이 아님'];
        feedback = lastErrors.join('\n');
        continue;
      }

      raw.rawText = input.rawText;
      raw.rawTextHash = sha256(input.rawText);
      raw.normalizerVersion = `${NORMALIZER_VERSION}-deepseek`;
      raw.extractedAt = new Date().toISOString();

      const validation = validateIntake(raw);
      if (validation.success && validation.data) {
        console.log(`[normalize-with-llm deepseek] 성공 (attempt ${attempt + 1}/${opts.maxRetries + 1})`);
        return {
          success: true,
          ir: validation.data,
          rawLlmResponse: raw,
          tokensUsed: {
            input: usage?.prompt_tokens || 0,
            output: usage?.completion_tokens || 0,
          },
          retryCount: attempt,
        };
      }

      lastErrors = validation.errors?.map((e) => `[${e.path.join('.')}] ${e.message}`) || ['알 수 없는 검증 실패'];
      feedback = lastErrors.slice(0, 10).join('\n');
      console.warn(`[normalize-with-llm deepseek] Zod 실패 attempt ${attempt + 1}:`, lastErrors.slice(0, 3));
    } catch (err) {
      lastErrors = [err instanceof Error ? err.message : 'DeepSeek 오류'];
      feedback = lastErrors.join('\n');
    }
  }
  return { success: false, errors: lastErrors, retryCount: opts.maxRetries };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Gemini 엔진 (fallback — structured output via responseSchema)
// ═══════════════════════════════════════════════════════════════════════════

async function runGemini(
  input: NormalizerInput,
  opts: { maxRetries: number; userMessage: string; model: string },
): Promise<NormalizerResult> {
  const client = getGeminiClient();
  const systemPrompt = await getPrompt('normalize-system', SYSTEM_PROMPT_FALLBACK);
  let lastErrors: string[] = [];
  let feedback: string | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const model = client.getGenerativeModel({
        model: opts.model,
        systemInstruction: systemPrompt,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: zodToGeminiSchema(NormalizedIntakeSchema) as unknown as Parameters<
            typeof model.generateContent
          >[0] extends { generationConfig?: { responseSchema?: infer S } } ? S : never,
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      });

      const prompt = feedback
        ? `${opts.userMessage}\n\n## 이전 시도 오류 (수정 요망):\n${feedback}`
        : opts.userMessage;

      const res = await model.generateContent(prompt);
      const txt = res.response.text();
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(txt);
      } catch {
        lastErrors = ['Gemini 응답이 유효한 JSON 이 아님'];
        feedback = lastErrors.join('\n');
        continue;
      }
      raw.rawText = input.rawText;
      raw.rawTextHash = crypto.createHash('sha256').update(input.rawText).digest('hex');
      raw.normalizerVersion = `${NORMALIZER_VERSION}-gemini`;
      raw.extractedAt = new Date().toISOString();

      const validation = validateIntake(raw);
      if (validation.success && validation.data) {
        return {
          success: true,
          ir: validation.data,
          rawLlmResponse: raw,
          tokensUsed: {
            input: res.response.usageMetadata?.promptTokenCount || 0,
            output: res.response.usageMetadata?.candidatesTokenCount || 0,
          },
          retryCount: attempt,
        };
      }
      lastErrors = validation.errors?.map((e) => `[${e.path.join('.')}] ${e.message}`) || ['알 수 없는 검증 실패'];
      feedback = lastErrors.slice(0, 10).join('\n');
    } catch (err) {
      lastErrors = [err instanceof Error ? err.message : 'Gemini 오류'];
      feedback = lastErrors.join('\n');
    }
  }
  return { success: false, errors: lastErrors, retryCount: opts.maxRetries };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Claude 엔진 (레거시 — engine='claude' 명시 시만 사용)
// ═══════════════════════════════════════════════════════════════════════════

async function runClaudeLegacy(
  input: NormalizerInput,
  opts: { maxRetries: number; userMessage: string; model: string },
  Anthropic: any,
  zodToClaudeSchema: any,
): Promise<NormalizerResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { success: false, errors: ['ANTHROPIC_API_KEY 누락 — Claude 레거시 엔진 사용 불가'] };
  const client = new Anthropic({ apiKey: key });
  const schema = zodToClaudeSchema(NormalizedIntakeSchema);
  const systemPrompt = await getPrompt('normalize-system', SYSTEM_PROMPT_FALLBACK);

  let lastErrors: string[] = [];
  let feedbackMessage: string | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        { role: 'user', content: opts.userMessage },
      ];
      if (feedbackMessage) {
        messages.push({
          role: 'user',
          content: `이전 시도에 Zod 검증 실패가 있었습니다. 다음 오류를 수정하여 재시도하세요:\n${feedbackMessage}`,
        });
      }

      const response = await client.messages.create({
        model: opts.model,
        max_tokens: 8192,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: [
          {
            name: 'emit_normalized_intake',
            description: '원문을 NormalizedIntake 로 구조화 출력',
            input_schema: schema,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tool_choice: { type: 'tool', name: 'emit_normalized_intake' },
        messages,
      });

      const toolUse = response.content.find((c: any) => c.type === 'tool_use');
      if (!toolUse) {
        lastErrors = ['LLM 응답에 tool_use 블록 없음'];
        feedbackMessage = lastErrors.join('\n');
        continue;
      }

      const raw = (toolUse as any).input as Record<string, unknown>;
      raw.rawText = input.rawText;
      raw.rawTextHash = sha256(input.rawText);
      raw.normalizerVersion = NORMALIZER_VERSION;
      raw.extractedAt = new Date().toISOString();

      const validation = validateIntake(raw);
      if (validation.success && validation.data) {
        return {
          success: true,
          ir: validation.data,
          rawLlmResponse: (toolUse as any).input,
          tokensUsed: { input: response.usage.input_tokens, output: response.usage.output_tokens },
          retryCount: attempt,
        };
      }
      lastErrors = validation.errors?.map((e) => `[${e.path.join('.')}] ${e.message}`) || ['알 수 없는 검증 실패'];
      feedbackMessage = lastErrors.slice(0, 10).join('\n');
    } catch (err) {
      lastErrors = [err instanceof Error ? err.message : '알 수 없는 LLM 오류'];
      feedbackMessage = lastErrors.join('\n');
    }
  }

  return { success: false, errors: lastErrors, retryCount: opts.maxRetries };
}
