import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { matchPackagesToLandOperators } from '@/lib/scoring/match-land-operators';
import { isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const postHandler = async () => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });

  try {
    const result = await matchPackagesToLandOperators();
    return apiResponse({ ok: true, ...result });
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
};

export const POST = withAdminGuard(postHandler);
