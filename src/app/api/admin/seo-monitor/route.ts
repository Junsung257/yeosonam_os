import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type DbErrorLike = { code?: string; message?: string };

function isMissingTable(error: DbErrorLike | null | undefined): boolean {
  return error?.code === 'PGRST205' || /Could not find the table/i.test(error?.message ?? '');
}

async function getHandler() {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const [snapshotRes, alertRes] =
    await Promise.all([
      supabaseAdmin
        .from('seo_daily_snapshots')
        .select('*')
        .order('date', { ascending: false })
        .limit(14),
      supabaseAdmin
        .from('seo_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

  let snapshots = snapshotRes.data ?? [];
  let alerts = alertRes.data ?? [];
  let snapshotError = snapshotRes.error;
  let alertError = alertRes.error;

  if (isMissingTable(snapshotError)) {
    const fallback = await supabaseAdmin
      .from('serp_snapshots')
      .select('*')
      .limit(14);
    snapshots = fallback.data ?? [];
    snapshotError = fallback.error && !isMissingTable(fallback.error) ? fallback.error : null;
  }

  if (isMissingTable(alertError)) {
    const fallback = await supabaseAdmin
      .from('rank_alerts')
      .select('*')
      .limit(30);
    alerts = fallback.data ?? [];
    alertError = fallback.error && !isMissingTable(fallback.error) ? fallback.error : null;
  }

  const error = snapshotError ?? alertError;
  if (error) {
    return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  }

  return apiResponse({
    snapshots: snapshots ?? [],
    alerts: alerts ?? [],
  });
}

export const GET = withAdminGuard(getHandler);
