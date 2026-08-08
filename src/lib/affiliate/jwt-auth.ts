import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { getAffiliateJwtSecret } from '@/lib/affiliate/auth-crypto';

const ALGORITHM = 'HS256';
const ISSUER = 'yeosonam-affiliate-auth';
const AUDIENCE = 'yeosonam-partner-portal';

interface AffiliateJwtPayload extends JWTPayload {
  sub: string;
  code: string;
  name: string;
  sid: string;
  jti: string;
  ver: number;
}

export interface AffiliateSessionTokenInput {
  affiliateId: string;
  referralCode: string;
  name: string;
  sessionId: string;
  jti: string;
  tokenVersion: number;
  expiresAt: Date;
}

export async function issueAffiliateToken(input: AffiliateSessionTokenInput): Promise<string> {
  return new SignJWT({
    sub: input.affiliateId,
    code: input.referralCode,
    name: input.name,
    sid: input.sessionId,
    jti: input.jti,
    ver: input.tokenVersion,
  } satisfies AffiliateJwtPayload)
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(input.expiresAt.getTime() / 1000))
    .sign(getAffiliateJwtSecret());
}

export async function verifyAffiliateToken(token: string): Promise<
  | {
      ok: true;
      affiliateId: string;
      code: string;
      name: string;
      sessionId: string;
      jti: string;
      tokenVersion: number;
      expiresAt: number;
    }
  | { ok: false; error: 'INVALID_SESSION_TOKEN' | 'AUTH_NOT_CONFIGURED' }
> {
  try {
    const { payload } = await jwtVerify(token, getAffiliateJwtSecret(), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const p = payload as AffiliateJwtPayload;
    if (
      !p.sub || !p.code || !p.sid || !p.jti ||
      !Number.isInteger(p.ver) || Number(p.ver) <= 0 || !p.exp
    ) {
      return { ok: false, error: 'INVALID_SESSION_TOKEN' };
    }
    return {
      ok: true,
      affiliateId: p.sub,
      code: p.code,
      name: p.name || '',
      sessionId: p.sid,
      jti: p.jti,
      tokenVersion: Number(p.ver),
      expiresAt: p.exp,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('AFFILIATE_AUTH_SECRET')) {
      return { ok: false, error: 'AUTH_NOT_CONFIGURED' };
    }
    return { ok: false, error: 'INVALID_SESSION_TOKEN' };
  }
}
