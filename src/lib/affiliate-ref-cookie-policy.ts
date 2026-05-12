import type { NextRequest } from 'next/server';

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

/**
 * `AFFILIATE_REF_STRICT_MARKETING_CONSENT=true` 이면:
 *   - `ys_marketing_consent=true` 쿠키가 있을 때만 aff_ref 30일
 *   - 없으면 세션 쿠키(Max-Age 없음 → 브라우저 닫으면 소멸, PIPA 대비)
 * 그 외(기본): 항상 30일 (사장님 암무동의 운영과 동일)
 */
export function getAffiliateRefCookieMaxAgeSec(request: NextRequest): number | undefined {
  const strict = process.env.AFFILIATE_REF_STRICT_MARKETING_CONSENT === 'true';
  if (!strict) return THIRTY_DAYS_SEC;
  const agreed = request.cookies.get('ys_marketing_consent')?.value === 'true';
  return agreed ? THIRTY_DAYS_SEC : undefined;
}
