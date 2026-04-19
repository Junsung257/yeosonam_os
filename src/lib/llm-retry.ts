/**
 * @file llm-retry.ts
 * @description LLM API 호출 시 일시 오류(502, 타임아웃) 및 스키마 위반 응답에 대한
 *              자동 재시도 래퍼. Exponential backoff 사용.
 *
 * 사용 예:
 * ```typescript
 * const result = await withRetry(async () => {
 *   const raw = await gemini.generateContent({ ... });
 *   const parsed = JSON.parse(stripMarkdown(raw));
 *   const validated = PackageCoreSchema.parse(parsed);  // Zod throws on fail
 *   return validated;
 * }, { maxAttempts: 3, label: 'parse-package' });
 * ```
 */

export interface RetryOptions {
  maxAttempts?: number;          // 기본 3 (1차 시도 + 재시도 2회)
  baseDelayMs?: number;          // 기본 1000 (1초)
  maxDelayMs?: number;           // 기본 8000 (8초)
  label?: string;                // 로그용
  shouldRetry?: (err: unknown) => boolean;
}

export interface RetryResult<T> {
  success: true;
  value: T;
  attempts: number;
}
export interface RetryFail {
  success: false;
  error: unknown;
  attempts: number;
  attemptErrors: string[];       // 각 시도별 에러 메시지
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T> | RetryFail> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelay = options.baseDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 8000;
  const label = options.label || 'llm-call';
  const shouldRetry = options.shouldRetry || defaultShouldRetry;

  const attemptErrors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn();
      return { success: true, value, attempts: attempt };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      attemptErrors.push(`[${attempt}/${maxAttempts}] ${errMsg}`);
      console.warn(`[${label}] attempt ${attempt} failed: ${errMsg}`);

      // 마지막 시도면 에러 반환
      if (attempt === maxAttempts) {
        return { success: false, error: err, attempts: attempt, attemptErrors };
      }

      // 재시도 불가 에러면 즉시 반환
      if (!shouldRetry(err)) {
        return { success: false, error: err, attempts: attempt, attemptErrors };
      }

      // Exponential backoff: 1s, 2s, 4s, 8s... (maxDelay cap)
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      // Jitter 추가 (±20%) — thundering herd 방지
      const jitter = delay * (0.8 + Math.random() * 0.4);
      await new Promise(r => setTimeout(r, jitter));
    }
  }

  // 도달 불가 (타입 안정성)
  return { success: false, error: new Error('Retry loop exited abnormally'), attempts: maxAttempts, attemptErrors };
}

/**
 * 기본 재시도 정책:
 * - 네트워크 오류 (ECONNRESET, ETIMEDOUT 등): 재시도
 * - HTTP 5xx: 재시도
 * - HTTP 429 (rate limit): 재시도
 * - HTTP 4xx (429 외): 재시도 안 함 (요청 자체가 잘못됨)
 * - Zod ValidationError: 재시도 (LLM이 스키마 위반 시 한 번 더 기회)
 * - 그 외: 재시도
 */
function defaultShouldRetry(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);

  // 명백한 4xx (429 제외) → 재시도 불가
  if (/HTTP 4(?!29)\d\d|status (400|401|403|404)/.test(msg)) return false;

  // 권한/인증 → 재시도 불가
  if (/unauthorized|forbidden|api.*key.*invalid/i.test(msg)) return false;

  // 나머지는 재시도
  return true;
}

/**
 * 여러 LLM 응답을 정리하는 헬퍼 — ```json``` 마크다운 / 앞뒤 공백 제거
 */
export function stripMarkdownJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}
