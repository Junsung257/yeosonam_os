import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';

/**
 * 발행 정책 관리 API
 *   GET    /api/admin/publishing-policy           → 모든 정책
 *   GET    /api/admin/publishing-policy?scope=X   → 단일
 *   PATCH  /api/admin/publishing-policy           → 부분 업데이트 (scope 필수)
 */

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return apiResponse({ items: [] });

  const scope = request.nextUrl.searchParams.get('scope');
  let query = supabaseAdmin.from('publishing_policies').select('*').order('scope', { ascending: true });
  if (scope) query = query.eq('scope', scope);

  const { data, error } = await query;
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ items: data || [] });
}

const patchHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) return apiResponse({ error: 'DB 미설정' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }

  try {
    const { scope, ...updates } = body;
    if (!scope) return apiResponse({ error: 'scope 필수' }, { status: 400 });

    // 화이트리스트 필드만
    const allowed = [
      'posts_per_day', 'per_destination_daily_cap', 'slot_times',
      'product_ratio', 'enabled', 'multi_angle_count', 'multi_angle_gap_days',
      'auto_trigger_card_news', 'auto_trigger_orchestrator',
      'auto_regenerate_underperformers', 'daily_summary_webhook',
    ];
    const update: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in updates) update[k] = updates[k];
    }

    const { data, error } = await supabaseAdmin
      .from('publishing_policies')
      .update(update)
      .eq('scope', scope)
      .select();

    if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
    return apiResponse({ item: data?.[0] });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, '업데이트 실패') }, { status: 500 });
  }
}

export const GET = withAdminGuard(getHandler);

export const PATCH = withAdminGuard(patchHandler);
