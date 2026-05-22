/**
 * RC2 (2026-05-20): 옛 parser.ts 콤마 split 폭주 시그니처 감지.
 * length > 20 && 모든 항목 < 30자 → backfill 자동 force 트리거.
 */

export function looksLikeCommaSplitBroken(items: unknown[] | null | undefined): boolean {
  if (!Array.isArray(items) || items.length <= 20) return false;
  const strings = items.filter((x): x is string => typeof x === 'string');
  if (strings.length !== items.length) return false;
  return strings.every(s => s.length > 0 && s.length < 30);
}
