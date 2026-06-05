/**
 * RC2 (2026-05-20): 옛 parser.ts 콤마 split 폭주 시그니처 감지.
 * length > 20 && 모든 항목 < 30자 → backfill 자동 force 트리거.
 * ERR-BOH-meal-days — "3,4일차" 가 "3" + "4일차…" 로 깨진 경우 (소량 배열).
 */

export function looksLikeCommaSplitBroken(items: unknown[] | null | undefined): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  const strings = items.filter((x): x is string => typeof x === 'string');
  if (strings.length !== items.length) return false;

  if (strings.length > 20 && strings.every(s => s.length > 0 && s.length < 30)) {
    return true;
  }

  // 고아 일차 숫자: "3" + "4일차중식" (원문 "3,4일차중식" 콤마 오분리)
  const hasOrphanDayDigit = strings.some((s, i) => {
    const t = s.trim();
    if (!/^\d{1,2}$/.test(t)) return false;
    return strings.some((other, j) => j !== i && /^\d+일차/.test(other.trim()));
  });
  if (hasOrphanDayDigit) return true;

  const hasSplitThousandsAmount = strings.some((s, i) => {
    const current = s.trim();
    const next = strings[i + 1]?.trim() ?? '';
    return /(?:^|[/\s])\d{1,3}$/.test(current) && /^000(?:원|P|페소|엔|달러|\/|$)/i.test(next);
  });
  if (hasSplitThousandsAmount) return true;

  return false;
}
