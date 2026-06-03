/**
 * GET /api/admin/scoring/trends — v_package_rank_trends 데이터.
 */
import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getHandler = async () => {
  if (!isSupabaseConfigured) return apiResponse({ trends: [] });
  const { data, error } = await supabaseAdmin
    .from('v_package_rank_trends')
    .select('*')
    .gte('snapshots', 2)         // 최소 2개 스냅샷 있어야 변동 의미
    .order('last_seen', { ascending: false })
    .limit(200);
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ trends: data ?? [] });
}

export const GET = withAdminGuard(getHandler);
