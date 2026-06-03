/**
 * GET /api/admin/alerts?showAcked=true|false
 *
 * /admin/alerts 페이지 데이터 — 알림 목록 + 통계 카드.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getHandler = async (req: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) return apiResponse({ alerts: [], stats: null });

  const showAcked = req.nextUrl.searchParams.get('showAcked') === 'true';
  const refId = req.nextUrl.searchParams.get('refId')?.trim() || null;
  const category = req.nextUrl.searchParams.get('category')?.trim() || null;

  let q = supabaseAdmin
    .from('admin_alerts')
    .select('id, created_at, category, severity, title, message, ref_type, ref_id, acknowledged_at, resolved_at, meta')
    .order('created_at', { ascending: false })
    .limit(200);
  if (!showAcked) q = q.is('acknowledged_at', null);
  if (refId) q = q.eq('ref_id', refId);
  if (category) q = q.eq('category', category);

  const [alertsRes, allRes] = await Promise.all([
    q,
    supabaseAdmin.from('admin_alerts').select('category, severity, acknowledged_at, created_at'),
  ]);

  if (alertsRes.error) return apiResponse({ error: sanitizeDbError(alertsRes.error) }, { status: 500 });
  if (allRes.error) return apiResponse({ error: sanitizeDbError(allRes.error) }, { status: 500 });

  const all = allRes.data ?? [];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const stats = {
    total: all.length,
    unacked: all.filter((a: Record<string, unknown>) => !a.acknowledged_at).length,
    by_category: countBy(all, 'category'),
    by_severity: countBy(all.filter((a: Record<string, unknown>) => (a.created_at as string) >= weekAgo), 'severity'),
  };

  return apiResponse({ alerts: alertsRes.data ?? [], stats });
};

export const GET = withAdminGuard(getHandler);

function countBy<T extends Record<string, unknown>>(arr: T[], key: keyof T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of arr) {
    const v = String(r[key] ?? 'unknown');
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}
