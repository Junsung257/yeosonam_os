/**
 * GET /api/admin/scoring/widget
 *
 * /admin 메인 대시보드 ScoringKpiWidget 데이터.
 * - 활성 정책 / 그룹 수 / score row / LTR 진행 / 미해결 알림 / 최근 winner
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ active_policy_version: null });
  const [policyRes, groupsRes, ltrRes, alertsRes, abRes] = await Promise.all([
    supabaseAdmin.from('scoring_policies').select('version').eq('is_active', true).limit(1).single(),
    supabaseAdmin.from('package_scores').select('group_key', { count: 'exact', head: true }),
    supabaseAdmin.from('v_ltr_signals').select('*', { count: 'exact', head: true }).gte('label_relevant', 0),
    supabaseAdmin.from('admin_alerts').select('id', { count: 'exact', head: true }).is('acknowledged_at', null),
    supabaseAdmin.from('policy_ab_results').select('policy_b_version, confidence').not('winner', 'is', null).order('measured_at', { ascending: false }).limit(1),
  ]);

  const ltrSamples = ltrRes.count ?? 0;
  return NextResponse.json({
    active_policy_version: policyRes.data?.version ?? null,
    total_groups: groupsRes.count ?? 0,
    total_score_rows: groupsRes.count ?? 0, // 같은 그룹 N row니 별도 count
    ltr_samples: ltrSamples,
    ltr_ready: ltrSamples >= 1000,
    unacked_alerts: alertsRes.count ?? 0,
    recent_winner: abRes.data?.[0] ? {
      policy_version: abRes.data[0].policy_b_version,
      confidence: abRes.data[0].confidence,
    } : null,
  });
}
