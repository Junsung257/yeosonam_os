import { NextRequest } from 'next/server';
import { authAffiliate } from '@/lib/affiliate/auth-service';

/**
 * Shared affiliate auth bridge for influencer routes.
 * Prefers inf_token JWT and falls back to referral_code + PIN through authAffiliate().
 */
export async function authInfluencer(
  req: NextRequest,
  referral_code: string,
  bodyPin?: string | null,
): Promise<
  { ok: true; affiliate: Record<string, unknown> }
  | { ok: false; error: string; status: number }
> {
  const auth = await authAffiliate(req, { referralCode: referral_code, pin: bodyPin });
  if (!auth.ok) return { ok: false, error: auth.error, status: auth.status };
  return { ok: true, affiliate: auth.affiliate };
}
