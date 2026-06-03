import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { fitHedonicCoefs } from '@/lib/scoring/hedonic-fit';
import { recomputeAllScores } from '@/lib/scoring/recommend';
import { logError } from '@/lib/sentry-logger';
import { isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const postHandler = async () => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  const startedAt = Date.now();
  try {
    const first = await recomputeAllScores();
    const hedonic = await fitHedonicCoefs();
    const second = await recomputeAllScores();

    return apiResponse({
      ok: true,
      ms: Date.now() - startedAt,
      first: { groups: first.groups, packages: first.packages },
      hedonic: {
        sample_size: hedonic.sample_size,
        computed_from: hedonic.computed_from,
        shopping_per_count: hedonic.shopping_per_count,
        meal_per_count: hedonic.meal_per_count,
        hotel_grade_step: hedonic.hotel_grade_step,
      },
      second: { groups: second.groups, packages: second.packages, version: second.policy_version },
    });
  } catch (e) {
    logError('[admin/scoring/recompute] recompute failed', e);
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
};

export const POST = withAdminGuard(postHandler);
