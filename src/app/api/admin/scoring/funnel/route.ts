/**
 * GET /api/admin/scoring/funnel
 *
 * v_recommendation_funnel + v_ltr_signals 집계 → /admin/scoring/funnel UI 데이터.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ funnel: [], summary: null });
  }
  try {
    const [funnelRes, ltrCountRes, abRes, alertsRes] = await Promise.all([
      supabaseAdmin.from('v_recommendation_funnel').select('*').order('exposures', { ascending: false }),
      supabaseAdmin.from('v_ltr_signals').select('*', { count: 'exact', head: true }).gte('label_relevant', 0),
      supabaseAdmin.from('policy_ab_results').select('*').order('measured_at', { ascending: false }).limit(10),
      supabaseAdmin.from('admin_alerts').select('*').is('acknowledged_at', null).order('created_at', { ascending: false }).limit(20),
    ]);
    if (funnelRes.error) throw funnelRes.error;

    const funnel = funnelRes.data ?? [];
    const totalExposures = funnel.reduce((s: number, r: Record<string, unknown>) => s + (Number(r.exposures) || 0), 0);
    const totalBookings = funnel.reduce((s: number, r: Record<string, unknown>) => s + (Number(r.bookings) || 0), 0);

    return NextResponse.json({
      funnel,
      ab_results: abRes.data ?? [],
      alerts: alertsRes.data ?? [],
      summary: {
        total_exposures: totalExposures,
        total_bookings: totalBookings,
        overall_booking_rate_pct: totalExposures > 0 ? (totalBookings / totalExposures * 100) : 0,
        ltr_training_samples: ltrCountRes.count ?? 0,
        ltr_ready: (ltrCountRes.count ?? 0) >= 1000,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
