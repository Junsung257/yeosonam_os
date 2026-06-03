import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { fitLandOperatorReliability } from '@/lib/scoring/reliability-fit';
import { isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const postHandler = async () => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });

  try {
    const result = await fitLandOperatorReliability();
    return apiResponse({ ok: true, ...result });
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
};

export const POST = withAdminGuard(postHandler);
