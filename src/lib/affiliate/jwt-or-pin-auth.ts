import { NextRequest } from 'next/server';
import { authAffiliate } from '@/lib/affiliate/auth-service';

/**
 * Compatibility bridge for legacy influencer route names.
 * Authentication itself is session-only; bodyPin is deliberately ignored.
 */
export async function authInfluencer(
  req: NextRequest,
  referral_code: string,
  _bodyPin?: string | null,
): Promise<
  { ok: true; affiliate: Record<string, unknown> }
  | { ok: false; error: string; status: number }
> {
  const auth = await authAffiliate(req, { referralCode: referral_code });
  if (!auth.ok) return { ok: false, error: auth.error, status: auth.status };
  return { ok: true, affiliate: auth.affiliate };
}
