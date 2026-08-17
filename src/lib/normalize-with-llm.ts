/**
 * @file normalize-with-llm.ts — Phase 1.5 L1 LLM Normalizer (V3 — DeepSeek 전면 전환)
 *
 * 원문 텍스트 → NormalizedIntake (IR) 변환.
 *
 * V3 변경 (2026-05-01):
 *   - 기본·유일한 등록 엔진: DeepSeek V4-Pro (OpenAI 호환 API)
 *   - 등록 경로에서는 Gemini/Claude fallback을 사용하지 않음
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
import {
  NormalizedIntakeSchema,
  validateIntake,
  NORMALIZER_VERSION,
  type NormalizedIntake,
} from './intake-normalizer';
import { retrieveSimilarExamples, buildFewShotPromptFragment, type SimilarExample } from './few-shot-retriever';
import { getRelevantReflections, buildReflectionPromptFragment, trackReflectionApplied } from './reflection-memory';
import { createClient } from '@supabase/supabase-js';
import { getPrompt } from './prompt-loader';
import { getSecret } from '@/lib/secret-registry';

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
  formatFingerprint?: string;
  sectionFingerprints?: Array<{ label: string; hash: string; exactHash?: string; charLength: number }>;
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
  const key = getSecret('DEEPSEEK_API_KEY');
  if (!key) throw new Error('DEEPSEEK_API_KEY 누락 — .env.local 확인');
  return new OpenAI({ apiKey: key, baseURL: 'https://api.deepseek.com' });
}

/**
 * 원문을 IR 로 정형화.
 *
 * @param input  원문 + 랜드사 + 마진율 + (옵션) 지역/국가 힌트
 * @param options engine('deepseek'), 재시도, 모델 선택
 */
export async function normalizeWithLlm(
  input: NormalizerInput,
  options: {
    engine?: 'deepseek';
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
  const supabaseUrl = getSecret('NEXT_PUBLIC_SUPABASE_URL') || getSecret('SUPABASE_URL');
  const supabaseKey = getSecret('SUPABASE_SERVICE_ROLE_KEY');
  if (supabaseUrl && supabaseKey) {
    sb = createClient(supabaseUrl, supabaseKey);
  }

  // ── EPR + Reflexion 병렬 조회 (독립적 쿼리이므로 Promise.all로 동시 실행) ─
  let fewShotFragment = '';
  let fewShotCount = 0;
  let reflectionFragment = '';
  let reflectionIds: string[] = [];

  const [eprResult, reflexionResult] = await Promise.all([
    // EPR의 기존 임베딩 공급자는 Gemini 전용이므로 DeepSeek-only 등록
    // 정책에서는 호출하지 않는다. 원문 사실을 다른 모델의 임베딩 결과로
    // 보강하지 않고, reflection(내부 DB 규칙)만 유지한다.
    (fewShotEnabled && false && sb)
      ? retrieveSimilarExamples(input.rawText, sb as unknown as Parameters<typeof retrieveSimilarExamples>[1], '', {
          limit: fewShotLimit,
          minSimilarity: 0.55,
        }).catch((e: unknown) => {
          console.warn('[normalize-with-llm EPR] retrieval disabled:', e instanceof Error ? e.message : e);
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
    input.formatFingerprint ? `## 원문 양식 fingerprint: ${input.formatFingerprint}` : '',
    input.sectionFingerprints?.length
      ? `## 섹션 fingerprint (hash=양식 참고용, exact=동일 섹션 캐시 키)\n${input.sectionFingerprints.map(s => `- ${s.label}: hash=${s.hash}${'exactHash' in s && s.exactHash ? ` exact=${s.exactHash}` : ''} (${s.charLength} chars)`).join('\n')}`
      : '',
    '',
    '## 원문',
    input.rawText,
    '',
    '위 원문을 NormalizedIntake 로 정형화하세요.',
    fewShotCount > 0 ? '⚠️ 위 "유사 등록 사례"는 패턴 참고용입니다. 사실 추출은 반드시 **이번 원문**에만 근거.' : '',
    reflectionIds.length > 0 ? '🚨 위 "과거 정정 사례"의 실수를 절대 반복하지 마세요.' : '',
  ].filter(Boolean).join('\n');

  const userMessage = buildUserMessage();

  // ── 등록 호출은 DeepSeek만 허용 ─
  if (engine !== 'deepseek') {
    return {
      success: false,
      errors: ['PRODUCT_REGISTRATION_DEEPSEEK_ONLY'],
      retryCount: 0,
    };
  }

  const result: NormalizerResult = await runDeepSeek(input, {
    maxRetries,
    userMessage,
    model: options.model || 'deepseek-v4-pro',
  });

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
      const cacheHitTokens = ((usage as unknown as Record<string, unknown>)?.prompt_cache_hit_tokens as number) ?? 0;
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
// Gemini/Claude 직접 실행기와 fallback은 등록 경로에서 제거했습니다.
// 모든 정규화 호출은 위의 runDeepSeek만 통과합니다.
