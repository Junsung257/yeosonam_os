/**
 * @file supabase-filter-safe.ts
 * @description PostgREST .or() / .ilike() 필터 인젝션 방어 유틸
 *
 * PostgREST 필터 문법:
 *   - `,` = 필터 구분자 (.or() 안에서 OR 결합)
 *   - `:` = operator 구분 (eq:val, ilike:val)
 *   - `(` `)` = 그룹핑
 *   - `*` = ilike 와일드카드
 *
 * 사용자 입력에 위 문자가 있으면 의도하지 않은 OR 분기·operator 변경이 가능.
 * 모든 사용자 입력은 이 함수로 정제 후 .or()/.ilike()에 사용한다.
 *
 * 참고:
 *   - SQL injection 자체는 PostgREST 파서가 막으나, 필터 로직 manipulation 은 가능.
 *   - 예: `?q=xxx,id.eq.1` → q 검색 + id=1 OR 조건 추가 → 의도치 않은 데이터 노출.
 */

/** PostgREST .or()/.ilike() 필터 값에서 위험 문자 제거 */
export function escapePostgrestFilterValue(input: string): string {
  if (typeof input !== 'string') return '';
  // 필터 메타문자 제거 (와일드카드는 호출자가 의도적으로 추가)
  return input.replace(/[,():*\\]/g, '').trim();
}

/** ilike 패턴용: 메타문자 제거 + LIKE 와일드카드(`%`, `_`) 이스케이프 */
export function escapePostgrestIlikeValue(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[,():*\\]/g, '')
    .replace(/[%_]/g, '\\$&')
    .trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID 형식 검증 — query param에서 받은 ID를 .or()/.eq()에 넣기 전 게이트 */
export function isValidUuid(input: unknown): input is string {
  return typeof input === 'string' && UUID_RE.test(input);
}
