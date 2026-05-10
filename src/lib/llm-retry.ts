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
 * LLM 응답에서 JSON 본체를 안전하게 추출. 2026-05-10 BAML SAP 패턴 흡수.
 *
 * 처리 가능한 케이스:
 *   1) `\`\`\`json\n{...}\n\`\`\`` — 코드펜스 (구버전 기능)
 *   2) `여기 결과입니다: {...}` — 앞에 설명문
 *   3) `{...} 위와 같습니다.` — 뒤에 설명문
 *   4) `{"code": "\`\`\`python\\n...\`\`\`"}` — JSON 값 안에 코드펜스 임베드 (string 인식)
 *   5) `{"a": "with \\"escaped\\" quotes"}` — 이스케이프된 따옴표
 *   6) `[{"a":1},{"b":2}` (응답 잘림) — 누락된 close brace 복구 시도
 *   7) `{"a": "unfinished` — 닫히지 않은 string 복구 시도
 *
 * 정상 JSON 입력은 그대로 반환 (하위호환).
 */
export function stripMarkdownJson(raw: string): string {
  if (!raw) return raw;

  // 1) 코드펜스 제거 (앞·뒤 모두)
  let s = raw
    .replace(/^[\s﻿]*```(?:json)?\s*/i, '')
    .replace(/\s*```[\s﻿]*$/i, '')
    .trim();

  // 2) 첫 '{' 또는 '[' 위치 찾기 — 그 앞 prose 무시
  const startIdx = findJsonStart(s);
  if (startIdx === -1) return s; // JSON 시작점 못 찾으면 원본 반환

  // 3) string-aware brace/bracket 균형 추적
  const endIdx = findJsonEnd(s, startIdx);
  if (endIdx !== -1) {
    return s.slice(startIdx, endIdx + 1);
  }

  // 4) 균형 안 맞음(잘림 의심) → 최소 복구 시도
  return repairTruncatedJson(s.slice(startIdx));
}

function findJsonStart(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') return i;
  }
  return -1;
}

/**
 * string 인식 brace 매칭. start 위치의 여는 괄호({ 또는 [)에 짝이 맞는 닫는 괄호 위치 반환.
 * 균형 안 맞으면 -1.
 */
function findJsonEnd(s: string, start: number): number {
  const open = s[start];
  if (open !== '{' && open !== '[') return -1;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (inString) {
      if (c === '\\') { escapeNext = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 잘린 JSON 복구 — string 안 잘림 / trailing comma / 누락 close brace 처리.
 * 완벽한 복구는 불가능 — 호출부의 JSON.parse 가 여전히 실패할 수 있고
 * 그 경우 `callWithZodValidation` 재시도 루프가 잡는다.
 */
function repairTruncatedJson(s: string): string {
  const stack: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (inString) {
      if (c === '\\') { escapeNext = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }

  let repaired = s;
  // 닫히지 않은 string 종료
  if (inString) repaired += '"';
  // trailing comma/공백 제거 (배열·객체 마지막 원소 잘림 대응)
  repaired = repaired.replace(/[,\s]+$/, '');
  // 부족한 닫는 괄호 보충 (LIFO 순서)
  while (stack.length > 0) {
    repaired += stack.pop();
  }
  return repaired;
}
