import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const dynamic = 'force-dynamic';

/** 모든 정책 목록 (A/B 비교용 — 활성 + shadow 모두) */
const getHandler = async () => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  const { data, error } = await supabaseAdmin
    .from('scoring_policies')
    .select('id, version, is_active, weights, notes, updated_at')
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ policies: data ?? [] });
}

export const GET = withAdminGuard(getHandler);
