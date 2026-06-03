import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function getHandler() {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  const [{ data: snapshots, error: snapshotError }, { data: alerts, error: alertError }] =
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
