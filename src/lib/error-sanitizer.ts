/**
 * @file error-sanitizer.ts
 * @description 클라이언트 응답에 노출되는 에러 메시지 정제 유틸
 *
 * 목적:
 *   `NextResponse.json({ error: err.message })` 패턴이 광범위하게 쓰이며
 *   Supabase/PostgREST 내부 코드(PGRST116, duplicate key, schema 정보)·
 *   service-role key 흔적·내부 경로가 그대로 노출될 위험.
 *
 * 정책:
 *   - 알려진 위험 패턴(PGRST*, sk_*, JWT 흔적, 내부 file path)은 일반화 메시지로 교체
 *   - 사용자에게 의미 있는 비즈니스 메시지는 보존 (한국어 도메인 메시지 등)
 *   - 너무 길면(>200자) 잘라서 일반화 — 스택 추적 누출 방어
 *
 * 사용:
 *   ```ts
 *   } catch (err) {
 *     console.error('[my-route]', err);  // 풀 로그는 서버에만
 *     return NextResponse.json({ error: sanitizeDbError(err) }, { status: 500 });
 *   }
 *   ```
 */

const RISK_PATTERNS: Array<[RegExp, string]> = [
  // PostgREST 에러 코드 (PGRST000 ~ PGRST999)
  [/PGRST\d{3}/i, 'DB 조회 실패'],
  // Postgres native 에러 (constraint violations, duplicate key 등)
  [/duplicate key value/i, '이미 존재하는 데이터입니다'],
  [/violates foreign key/i, '관련 데이터 제약 위반'],
  [/violates not-null constraint/i, '필수 항목 누락'],
  [/violates unique constraint/i, '중복된 값입니다'],
  [/violates check constraint/i, '데이터 형식 오류'],
  // API key / token 흔적
  [/sk-[a-zA-Z0-9_-]{10,}/, '[redacted]'],
  [/pk_[a-zA-Z0-9_-]{10,}/, '[redacted]'],
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, '[redacted-jwt]'],
  // 내부 파일 경로 (Windows/POSIX)
  [/[A-Z]:\\[^\s]+\\src\\/g, '[internal-path]'],
  [/\/Users\/[^\s/]+\/[^\s]+/g, '[internal-path]'],
  [/\/home\/[^\s/]+\/[^\s]+/g, '[internal-path]'],
  // Supabase URL 흔적
  [/https:\/\/[a-z0-9-]+\.supabase\.co/gi, '[supabase-url]'],
];

const MAX_MESSAGE_LENGTH = 200;
const GENERIC_FALLBACK = '요청 처리 중 오류가 발생했습니다';

/**
 * 에러 객체에서 클라이언트에 안전하게 노출 가능한 메시지를 추출.
 * @param err — try/catch 에서 잡은 unknown
 * @param fallback — 정제 후 빈 문자열이 되면 사용할 기본 메시지
 */
export function sanitizeDbError(err: unknown, fallback: string = GENERIC_FALLBACK): string {
  if (err == null) return fallback;

  let msg = '';
  if (err instanceof Error) {
    msg = err.message;
  } else if (typeof err === 'string') {
    msg = err;
  } else if (typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    msg = (err as { message: string }).message;
  } else {
    msg = String(err);
  }

  // 1. 위험 패턴 치환
  for (const [pattern, replacement] of RISK_PATTERNS) {
    msg = msg.replace(pattern, replacement);
  }

  // 2. 길이 제한 (스택 트레이스 흘러나오는 방어)
  if (msg.length > MAX_MESSAGE_LENGTH) {
    msg = msg.slice(0, MAX_MESSAGE_LENGTH).trim() + '...';
  }

  // 3. 빈 문자열 가드
  msg = msg.trim();
  if (!msg) return fallback;

  return msg;
}

/**
 * console.error 기록 + 클라이언트용 정제 메시지 한 번에.
 * 서버 로그엔 풀 정보, 응답엔 정제본만 남는 것을 보장.
 */
export function logAndSanitize(tag: string, err: unknown, fallback?: string): string {
  console.error(`[${tag}]`, err);
  return sanitizeDbError(err, fallback);
}
