/**
 * @file customer-name.ts
 * @description 고객명 정규화 + 유사도 비교
 *
 * 용도:
 * - 은행 counterparty_name → 대표자 1명만 추출 ("손지연,양동기" → "손지연")
 * - 고객 중복 매칭 판별 (표기 요동: "홍길동" vs "홍길 동" vs "홍 길동")
 */

// ── 대표자명 추출 ────────────────────────────────────────────────────────────

/**
 * 은행/입금자 필드에서 대표자 1명 추출.
 *
 * 규칙:
 * - 쉼표/세미콜론/슬래시/공백-다수 → 구분자로 간주, 첫 토큰 채택
 * - "외 N명", "외N명", "등 N명" → 제거
 * - 괄호/따옴표 안 보조표기 → 제거 ("(대표)", "님")
 * - 직함 접미사 → 제거 ("대표", "사장", "님", "씨")
 * - 양 끝 공백·제로폭 문자 trim
 */
export function extractPrimaryName(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';

  // 제로폭·NBSP 제거
  s = s.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');

  // "외 N명", "등 N명" 제거 (대표자 뒤 수식어)
  s = s.replace(/\s*(외|등)\s*\d+\s*명\s*$/g, '');
  s = s.replace(/\s*(외|등)\s*\d+\s*$/g, '');

  // 괄호·대괄호 안 내용 제거 ("(대표)", "[결제]")
  s = s.replace(/[(\[{（【][^)\]}）】]*[)\]}）】]/g, '');

  // 쉼표/세미콜론/슬래시/파이프로 분리 → 첫 토큰
  const SEPARATORS = /[,，、;/|·]/;
  if (SEPARATORS.test(s)) {
    s = s.split(SEPARATORS)[0];
  }

  // 공백 2개 이상 → 동반자 표기일 수 있으므로 첫 토큰 채택
  //  단, 한국어 성+이름 공백(한 칸) 케이스는 보존
  const parts = s.split(/\s{2,}/);
  if (parts.length > 1) s = parts[0];

  // 직함/경어 접미사 제거
  s = s.replace(/\s*(대표|사장|님|씨|고객|담당)\s*$/g, '');

  return s.trim();
}

// ── 이름 정규화 (비교용) ─────────────────────────────────────────────────────

/**
 * 이름을 비교 가능 형태로 정규화.
 * - 모든 공백 제거
 * - 영문은 소문자로
 * - 한자·한글·영문 외 문자 제거
 */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return extractPrimaryName(raw)
    .replace(/\s+/g, '')
    .replace(/[^\uAC00-\uD7A3\u4E00-\u9FFFa-zA-Z]/g, '')
    .toLowerCase();
}

// ── 전화번호 정규화 ──────────────────────────────────────────────────────────

/**
 * 전화번호를 숫자 11자리로 정규화. 11자리 아니면 null.
 * (기존 findOrCreateCustomerByPhone과 동일 규칙)
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

// ── 이름 유사도 (Levenshtein 기반) ──────────────────────────────────────────

/**
 * Levenshtein 거리. 짧은 한국어 이름(2~4자)에 최적화.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * 정규화된 이름 두 개의 유사도(0~1).
 * - 완전일치 1.0
 * - 빈 문자열 포함 시 0.0
 * - 한쪽이 다른쪽 접두/접미어일 때 보정 (예: "손지연" ⊂ "손지연양동기" → 0.95)
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  // 포함 관계: 짧은쪽이 긴쪽의 접두 or 접미
  if (nb.startsWith(na) || nb.endsWith(na) || na.startsWith(nb) || na.endsWith(nb)) {
    return 0.95;
  }

  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

/**
 * 중복 고객 판정 임계값.
 * - 이름 유사도 ≥ MATCH → 동일 인물 가능성 높음
 */
export const NAME_MATCH_THRESHOLD = 0.85;
