/**
 * @file /api/admin/booking-task-stats/route.ts
 * @description P13-5 booking task auto-resolve 시각화 API.
 *
 * 박제 (2026-05-13): booking_task_resolution_stats VIEW 응답 + summary 통계.
 */

import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface TaskStat {
  task_type: string;
  total_tasks: number;
  auto_resolved_count: number;
  manual_resolved_count: number;
  open_count: number;
  auto_resolve_rate_pct: number | null;
  avg_auto_resolve_hours: number | null;
  last_update: string | null;
}

async function getHandler() {
  if (!isSupabaseConfigured) return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  try {
    const { data, error } = await supabaseAdmin
      .from('booking_task_resolution_stats')
      .select('*');
    if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
    const stats = (data ?? []) as TaskStat[];

    const grandTotal = stats.reduce((s, r) => s + r.total_tasks, 0);
    const grandAuto = stats.reduce((s, r) => s + r.auto_resolved_count, 0);
    const grandManual = stats.reduce((s, r) => s + r.manual_resolved_count, 0);
    const grandOpen = stats.reduce((s, r) => s + r.open_count, 0);
    const overallRate = (grandAuto + grandManual) > 0
      ? Math.round((grandAuto / (grandAuto + grandManual)) * 1000) / 10
      : 0;

    return apiResponse({
      summary: {
        total: grandTotal,
        auto_resolved: grandAuto,
        manual_resolved: grandManual,
        open: grandOpen,
        overall_auto_rate_pct: overallRate,
      },
      by_rule: stats,
    });
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
}

export const GET = withAdminGuard(getHandler);
