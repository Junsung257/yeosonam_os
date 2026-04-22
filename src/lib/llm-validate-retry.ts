/**
 * @file llm-validate-retry.ts — W3 Pivot C (instructor-js 스타일)
 *
 * 목적:
 *   LLM 응답이 Zod 스키마를 위반하면, **원래 프롬프트 + 검증 에러 피드백**을
 *   함께 보내 한 번 더 기회를 준다. 단순 재시도(withRetry)는 같은 입력을 반복할
 *   뿐이지만, 이 래퍼는 모델에게 **무엇이 틀렸는지** 알려 자기수정(self-repair)을
 *   유도한다.
 *
 * 참조:
 *   - instructor-js (`jxnl/instructor`) — Pydantic/Zod 기반 structured output 자동 재시도
 *   - OpenAI cookbook "Function calling with data extraction" — validation-feedback loop
 *
 * 사용 예:
 * ```ts
 * import { PackageCoreSchema } from './package-schema';
 * import { callWithZodValidation } from './llm-validate-retry';
 *
 * const result = await callWithZodValidation({
 *   label: 'parse-package',
 *   schema: PackageCoreSchema,
 *   fn: async (feedback) => {
 *     const prompt = basePrompt + (feedback ?? '');
 *     const raw = await gemini.generateContent(prompt);
 *     return raw.response.text();
 *   },
 *   maxAttempts: 3,
 * });
 * if (result.success) use(result.value);
 * else console.error(result.attemptErrors);
 * ```
 *
 * 관련 에러 (W3 목표):
 *   - ERR-20260418-01 (min_participants 템플릿 기본값 주입)
 *   - ERR-20260418-02 (notices_parsed 예시 축약)
 *   - ERR-KUL-02/03 (DAY 교차 오염)
 *   - ERR-FUK-insurance-injection ("2억 여행자보험" 환각)
 *   - ERR-FUK-regions-copy (Day별 regions 복사)
 */

import { z } from 'zod';
import { withRetry, stripMarkdownJson, type RetryResult, type RetryFail } from './llm-retry';

// ═══════════════════════════════════════════════════════════════════════════
//  옵션 / 에러 타입
// ═══════════════════════════════════════════════════════════════════════════

export interface ValidateRetryOptions<T> {
  /**
   * LLM 호출 함수. 재시도 시 `feedback` 인자로 이전 시도의 Zod 검증 에러 메시지가 전달된다.
   * 이 feedback 을 프롬프트 말미에 붙여 보내 모델이 오류를 인지하고 자기수정하게 만든다.
   */
  fn: (feedback: string | null) => Promise<string>;
  /** 응답 JSON이 통과해야 하는 Zod 스키마 */
  schema: z.ZodType<T>;
  /** 기본 3 (최초 + 재시도 2) */
  maxAttempts?: number;
  /** 로그용 */
  label?: string;
  /** JSON 파싱 전 원본 정리 훅 (기본: stripMarkdownJson) */
  preprocessor?: (raw: string) => string;
  /** 재시도 개시 전 공통 시드 인자(원문, 이전 파싱결과 등) — 디버깅용 로그 */
  seedInfo?: Record<string, unknown>;
}

/** Zod 검증 실패를 재시도 대상으로 명시 (withRetry 가 잡음) */
export class ZodValidationRetryError extends Error {
  readonly feedback: string;
  readonly issues: z.ZodIssue[];
  constructor(feedback: string, issues: z.ZodIssue[]) {
    super(feedback);
    this.name = 'ZodValidationRetryError';
    this.feedback = feedback;
    this.issues = issues;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  핵심 — callWithZodValidation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LLM 응답을 Zod 검증 후, 위반 시 피드백을 담아 재요청한다.
 *
 * **재시도 흐름**:
 *   1) `fn(null)` 호출 → 첫 응답 받음
 *   2) stripMarkdownJson + JSON.parse → parse 실패 시 재시도 (feedback: "JSON parse 실패")
 *   3) `schema.safeParse` → 실패 시 재시도 (feedback: Zod issue 목록)
 *   4) 모든 attempt 실패 → RetryFail 반환
 *
 * **핵심 차이 (vs withRetry 단독)**:
 *   withRetry는 네트워크/5xx 에러에 대한 단순 재시도.
 *   이 래퍼는 "응답이 스키마 위반" 이라는 **구조적 결함**도 재시도 대상으로 삼고,
 *   모델에게 무엇이 틀렸는지 알려 자기수정하도록 한다.
 */
export async function callWithZodValidation<T>(
  options: ValidateRetryOptions<T>,
): Promise<RetryResult<T> | RetryFail> {
  const label = options.label || 'llm-validate';
  const preprocessor = options.preprocessor || stripMarkdownJson;
  const schema = options.schema;

  // feedback 은 시도 간에 공유되어야 함 (클로저로 전달)
  let pendingFeedback: string | null = null;

  return withRetry(async () => {
    const raw = await options.fn(pendingFeedback);
    const cleaned = preprocessor(raw);

    // 1) JSON parse
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pendingFeedback = buildJsonParseFeedback(cleaned, msg);
      throw new ZodValidationRetryError(pendingFeedback, []);
    }

    // 2) Zod validate
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      pendingFeedback = buildZodFeedback(validated.error.issues);
      throw new ZodValidationRetryError(pendingFeedback, validated.error.issues);
    }

    // 성공 — feedback 초기화 (retry 래퍼 입장에선 도달 불가지만 안전)
    pendingFeedback = null;
    return validated.data;
  }, {
    maxAttempts: options.maxAttempts ?? 3,
    label,
    // Zod/JSON 에러는 재시도, 권한 에러는 재시도 안 함 (기본 정책 유지)
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  피드백 메시지 빌더 — 모델에게 구체적 오류 맥락 전달
// ═══════════════════════════════════════════════════════════════════════════

function buildZodFeedback(issues: z.ZodIssue[]): string {
  const lines = issues.slice(0, 20).map(i => {
    const path = i.path.length ? i.path.join('.') : '(root)';
    return `- [${path}] ${i.message}`;
  });
  return [
    '',
    '=====',
    '이전 응답이 스키마 검증에 실패했다. 아래 문제를 정확히 고쳐서 다시 JSON만 반환하라:',
    ...lines,
    '',
    '규칙:',
    '- 코드펜스(```) 없이 순수 JSON만 반환',
    '- 누락 필드는 원문에서 재탐색 후 채울 것 (템플릿 기본값/상상값 금지)',
    '- 원문에 없는 값을 지어내지 말 것 (환각 엄금 — ERR-FUK-insurance-injection)',
    '=====',
  ].join('\n');
}

function buildJsonParseFeedback(responseExcerpt: string, parseErr: string): string {
  const head = responseExcerpt.slice(0, 200).replace(/\n/g, ' ');
  return [
    '',
    '=====',
    '이전 응답이 유효한 JSON이 아니다:',
    `- 에러: ${parseErr}`,
    `- 응답 첫 200자: ${head}${responseExcerpt.length > 200 ? '...' : ''}`,
    '',
    '규칙:',
    '- 코드펜스/주석/후행 텍스트 없이 순수 JSON만 반환',
    '- 문자열 안의 따옴표는 반드시 이스케이프',
    '=====',
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
//  편의 함수 — 단일-문장 버전 (피드백 자동 추가)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 가장 흔한 패턴: 고정 프롬프트 + LLM caller.
 * feedback 이 있으면 프롬프트 뒤에 자동 덧붙여 재전송.
 */
export async function parseWithValidation<T>(args: {
  basePrompt: string;
  caller: (fullPrompt: string) => Promise<string>;
  schema: z.ZodType<T>;
  label?: string;
  maxAttempts?: number;
}): Promise<RetryResult<T> | RetryFail> {
  return callWithZodValidation({
    label: args.label,
    schema: args.schema,
    maxAttempts: args.maxAttempts,
    fn: async (feedback) => {
      const fullPrompt = feedback ? `${args.basePrompt}${feedback}` : args.basePrompt;
      return args.caller(fullPrompt);
    },
  });
}
