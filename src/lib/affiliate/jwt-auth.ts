import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { getSecret } from '@/lib/secret-registry';

const ALGORITHM = 'HS256';

interface AffiliateJwtPayload extends JWTPayload {
  sub: string;        // affiliate_id
  code: string;       // referral_code
  name: string;
}

function getJwtSecret(): Uint8Array {
  const raw = (getSecret('AFFILIATE_JWT_SECRET') || '').trim();
  if (!raw) {
    throw new Error('AFFILIATE_JWT_SECRET is required');
  }
  return new TextEncoder().encode(raw);
}

/** PIN 인증 성공 후 JWT 발급 (24h 만료) */
export async function issueAffiliateToken(affiliate: {
  id: string;
  referral_code: string;
  name: string;
}): Promise<string> {
  return new SignJWT({ sub: affiliate.id, code: affiliate.referral_code, name: affiliate.name } satisfies AffiliateJwtPayload)
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getJwtSecret());
}

/** JWT 검증 및 페이로드 반환 */
export async function verifyAffiliateToken(token: string): Promise<{
  ok: true; affiliateId: string; code: string; name: string;
} | { ok: false; error: string }> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: [ALGORITHM] });
    const p = payload as AffiliateJwtPayload;
    if (!p.sub || !p.code) {
      return { ok: false, error: '토큰에 필수 정보가 없습니다.' };
    }
    return { ok: true, affiliateId: p.sub, code: p.code, name: p.name || '' };
  } catch {
    return { ok: false, error: '토큰 검증 실패' };
  }
}
