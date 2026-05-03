/**
 * 제휴 추천 코드(ref) 형식 검증 — 미들웨어(Edge)에서도 supabase 없이 사용 가능.
 * 쿠키 aff_ref, /with/[slug] 슬러그 등에 공통 적용.
 */
export function looksLikeReferralCode(s: string): boolean {
  const t = s.trim();
  if (t.length < 2 || t.length > 64) return false;
  if (/^https?:\/\//i.test(t)) return false;
  return /^[a-zA-Z0-9_-]+$/.test(t);
}

/**
 * DB `affiliates.referral_code` 및 쿠키 `aff_ref`와 동일하게 매칭하기 위한 정규화.
 * ASCII 알파벳은 대문자로 통일 → `?ref=heize`·`/with/heize`도 DB의 `HEIZE`와 귀속됨.
 * (Postgres `ILIKE`는 `_` 와일드카드 이슈가 있어 `eq` + 정규화가 안전.)
 */
export function normalizeAffiliateReferralCode(raw: string): string {
  return raw.trim().toUpperCase();
}
