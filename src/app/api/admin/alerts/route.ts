/**
 * GET /api/admin/alerts?showAcked=true|false
 *
 * /admin/alerts 페이지 데이터 — 알림 목록 + 통계 카드.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ alerts: [], stats: null });

  const showAcked = req.nextUrl.searchParams.get('showAcked') === 'true';

  let q = supabaseAdmin
    .from('admin_alerts')
    .select('id, created_at, category, severity, title, message, ref_type, ref_id, acknowledged_at, resolved_at, meta')
    .order('created_at', { ascending: false })
    .limit(200);
  if (!showAcked) q = q.is('acknowledged_at', null);

  const [alertsRes, allRes] = await Promise.all([
    q,
    supabaseAdmin.from('admin_alerts').select('category, severity, acknowledged_at, created_at'),
  ]);

  if (alertsRes.error) return NextResponse.json({ error: alertsRes.error.message }, { status: 500 });

  const all = allRes.data ?? [];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const stats = {
    total: all.length,
    unacked: all.filter((a: Record<string, unknown>) => !a.acknowledged_at).length,
    by_category: countBy(all, 'category'),
    by_severity: countBy(all.filter((a: Record<string, unknown>) => (a.created_at as string) >= weekAgo), 'severity'),
  };

  return NextResponse.json({ alerts: alertsRes.data ?? [], stats });
}

function countBy<T extends Record<string, unknown>>(arr: T[], key: keyof T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of arr) {
    const v = String(r[key] ?? 'unknown');
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}
