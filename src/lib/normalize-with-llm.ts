/**
 * @file normalize-with-llm.ts — Phase 1.5 L1 LLM Normalizer
 *
 * 원문 텍스트 → NormalizedIntake (IR) 변환.
 *
 * 엔진: Anthropic Claude Sonnet 4.6 + tool use (structured output)
 * 재시도: llm-validate-retry 패턴 (Zod 실패 시 LLM 에 피드백 재프롬프트)
 *
 * 보호 장치:
 *   1. Zod 스키마 강제 (zodToClaudeSchema → tool input_schema)
 *   2. rawText 원본 보존 + rawTextHash sha256
 *   3. min_participants 원문 N명 이상 1:1 강제
 *   4. inclusions 콤마 없는 단일 토큰 (W26)
 *   5. 하루 최대 1 flight (W27)
 *   6. regions 원문 "지역" 컬럼 1:1 (ERR-FUK-regions-copy)
 *
 * 비용: ~0.03 USD/건 (원문 3000자 기준)
 */

import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import {
  NormalizedIntakeSchema,
  validateIntake,
  NORMALIZER_VERSION,
  type NormalizedIntake,
} from './intake-normalizer';
import { zodToClaudeSchema, zodToGeminiSchema } from './llm-structured-output';

const SYSTEM_PROMPT = `당신은 여행 상품 원문을 구조화된 IR(Intermediate Representation) 로 변환하는 전문 정형화 Agent 입니다.

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
tool use 로만 응답. NormalizedIntake 스키마를 완벽히 준수.`;

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

function getClaudeClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY 누락 — .env.local 확인');
  return new Anthropic({ apiKey: key });
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
 * @param options engine('claude'|'gemini'), 재시도, 모델 선택
 */
export async function normalizeWithLlm(
  input: NormalizerInput,
  options: {
    engine?: 'claude' | 'gemini';
    model?: string;
    maxRetries?: number;
  } = {},
): Promise<NormalizerResult> {
  const { engine = 'claude', maxRetries = 2 } = options;

  const buildUserMessage = () => [
    `## 랜드사: ${input.landOperator}`,
    `## 마진율: ${input.commissionRate}%`,
    input.hintRegion ? `## 지역 힌트: ${input.hintRegion}` : '',
    input.hintCountry ? `## 국가 힌트: ${input.hintCountry}` : '',
    '',
    '## 원문',
    input.rawText,
    '',
    '위 원문을 NormalizedIntake 로 정형화하세요.',
  ].filter(Boolean).join('\n');

  if (engine === 'gemini') {
    return runGemini(input, { maxRetries, userMessage: buildUserMessage(), model: options.model || 'gemini-2.5-flash' });
  }
  return runClaude(input, { maxRetries, userMessage: buildUserMessage(), model: options.model || 'claude-sonnet-4-6' });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Gemini 엔진 (structured output via responseSchema)
// ═══════════════════════════════════════════════════════════════════════════

async function runGemini(
  input: NormalizerInput,
  opts: { maxRetries: number; userMessage: string; model: string },
): Promise<NormalizerResult> {
  const client = getGeminiClient();
  let lastErrors: string[] = [];
  let feedback: string | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const model = client.getGenerativeModel({
        model: opts.model,
        systemInstruction: SYSTEM_PROMPT,
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
//  Claude 엔진 (tool use)
// ═══════════════════════════════════════════════════════════════════════════

async function runClaude(
  input: NormalizerInput,
  opts: { maxRetries: number; userMessage: string; model: string },
): Promise<NormalizerResult> {
  const client = getClaudeClient();
  const schema = zodToClaudeSchema(NormalizedIntakeSchema);

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
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: 'emit_normalized_intake',
            description: '원문을 NormalizedIntake 로 구조화 출력',
            input_schema: schema as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: 'emit_normalized_intake' },
        messages,
      });

      const toolUse = response.content.find((c): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use');
      if (!toolUse) {
        lastErrors = ['LLM 응답에 tool_use 블록 없음'];
        feedbackMessage = lastErrors.join('\n');
        continue;
      }

      const raw = toolUse.input as Record<string, unknown>;
      raw.rawText = input.rawText;
      raw.rawTextHash = sha256(input.rawText);
      raw.normalizerVersion = NORMALIZER_VERSION;
      raw.extractedAt = new Date().toISOString();

      const validation = validateIntake(raw);
      if (validation.success && validation.data) {
        return {
          success: true,
          ir: validation.data,
          rawLlmResponse: toolUse.input,
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
