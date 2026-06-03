import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured } from '@/lib/supabase';
import { fitLandOperatorReliability } from '@/lib/scoring/reliability-fit';
import { logError } from '@/lib/sentry-logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return apiResponse({ skipped: true, reason: 'Supabase not configured' });
  }
  const startedAt = Date.now();
  try {
    const result = await fitLandOperatorReliability();
    return apiResponse({ ok: true, ms: Date.now() - startedAt, ...result });
  } catch (e) {
    logError('[cron/land-operator-reliability] fitting failed', e);
    return apiResponse(
      { error: sanitizeDbError(e, 'Land operator reliability fitting failed') },
      { status: 500 },
    );
  }
}
