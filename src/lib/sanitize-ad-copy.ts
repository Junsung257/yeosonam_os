/**
 * 광고 URL 파라미터(utm_term 등)로 넘긴 짧은 카피만 화면에 표시.
 * HTML·스크립트·제어문자 차단.
 */
export function sanitizeUtmTermForDisplay(raw: string | null): string | null {
  if (raw == null) return null;
  let t: string;
  try {
    t = decodeURIComponent(raw.replace(/\+/g, ' ')).trim();
  } catch {
    return null;
  }
  t = t.slice(0, 80);
  if (!t) return null;
  // 한·영·숫자·일부 구두점만 허용
  if (!/^[\p{L}\p{N}\s.,!?·\-_"'“”‘’]+$/u.test(t)) return null;
  return t;
}
