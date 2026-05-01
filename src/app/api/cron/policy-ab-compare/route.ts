/**
 * GET /api/cron/policy-ab-compare
 *
 * 매주 토요일 10:00 UTC — 활성 정책 vs 가장 최근 사용된 비활성 정책 booking_rate 비교.
 * recommendation_outcomes 의 policy_id로 그룹핑 → 신뢰도 (Wilson score interval) 계산.
 *
 * 충분한 신뢰도(95%)가 모이면 winner를 policy_ab_results에 INSERT.
 * 사장님이 /admin/scoring/funnel 에서 결과 보고 수동 활성 전환.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { postAlert } from '@/lib/admin-alerts';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface PolicyMeta {
  id: string;
  version: string;
  is_active: boolean;
}

interface PolicyKpi {
  policy_id: string | null;
  exposures: number;
  bookings: number;
  bookingValue: number;
}

/** Wilson score lower bound — 표본 적을 때 보수적 */
function wilsonLower(success: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = success / total;
  const denom = 1 + z * z / total;
  const center = p + z * z / (2 * total);
  const margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total));
  return Math.max(0, (center - margin) / denom);
}

async function loadKpi(policyId: string, since: string): Promise<PolicyKpi> {
  const [exp, bk, val] = await Promise.all([
    supabaseAdmin.from('recommendation_outcomes').select('id', { count: 'exact', head: true })
      .eq('policy_id', policyId).gte('recommended_at', since),
    supabaseAdmin.from('recommendation_outcomes').select('id', { count: 'exact', head: true })
      .eq('policy_id', policyId).eq('outcome', 'booking').gte('recommended_at', since),
    supabaseAdmin.from('recommendation_outcomes').select('outcome_value')
      .eq('policy_id', policyId).eq('outcome', 'booking').gte('recommended_at', since),
  ]);
  const value = (val.data ?? []).reduce((s: number, r: Record<string, unknown>) => s + (Number((r as { outcome_value: number | null }).outcome_value) || 0), 0);
  return {
    policy_id: policyId,
    exposures: exp.count ?? 0,
    bookings: bk.count ?? 0,
    bookingValue: value,
  };
}

async function handle(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ skipped: true });
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && auth !== expected) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 정책 목록
  const { data: policies, error } = await supabaseAdmin
    .from('scoring_policies')
    .select('id, version, is_active');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const ps = (policies ?? []) as PolicyMeta[];
  const active = ps.find(p => p.is_active);
  if (!active) return NextResponse.json({ skipped: true, reason: 'active 정책 없음' });

  // 최근 30일
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const periodStart = since.slice(0, 10);
  const periodEnd = new Date().toISOString().slice(0, 10);

  const activeKpi = await loadKpi(active.id, since);

  // 데이터 가장 많은 비활성 정책 1개 선정
  const inactive = ps.filter(p => !p.is_active);
  const candidateKpis: { policy: PolicyMeta; kpi: PolicyKpi }[] = [];
  for (const p of inactive) {
    const k = await loadKpi(p.id, since);
    if (k.exposures > 0) candidateKpis.push({ policy: p, kpi: k });
  }
  candidateKpis.sort((a, b) => b.kpi.exposures - a.kpi.exposures);
  const challenger = candidateKpis[0];
  if (!challenger) {
    return NextResponse.json({
      ok: true, skipped: true, reason: '비활성 정책 사용 데이터 없음',
      active_kpi: activeKpi,
    });
  }

  // booking_rate + Wilson score
  const aRate = activeKpi.exposures > 0 ? activeKpi.bookings / activeKpi.exposures : 0;
  const bRate = challenger.kpi.exposures > 0 ? challenger.kpi.bookings / challenger.kpi.exposures : 0;
  const aLower = wilsonLower(activeKpi.bookings, activeKpi.exposures);
  const bLower = wilsonLower(challenger.kpi.bookings, challenger.kpi.exposures);
  // winner 판단: lower bound 가 상대 upper bound 보다 명확히 높으면
  let winner: string | null = null;
  let confidence = 0;
  if (activeKpi.exposures >= 30 && challenger.kpi.exposures >= 30) {
    if (aLower > bRate) { winner = active.id; confidence = aLower - bRate; }
    else if (bLower > aRate) { winner = challenger.policy.id; confidence = bLower - aRate; }
  }

  const { error: insErr } = await supabaseAdmin.from('policy_ab_results').insert({
    policy_a_id: active.id,
    policy_b_id: challenger.policy.id,
    policy_a_version: active.version,
    policy_b_version: challenger.policy.version,
    period_start: periodStart, period_end: periodEnd,
    exposures_a: activeKpi.exposures, exposures_b: challenger.kpi.exposures,
    bookings_a: activeKpi.bookings, bookings_b: challenger.kpi.bookings,
    booking_rate_a: aRate, booking_rate_b: bRate,
    booking_value_a: activeKpi.bookingValue, booking_value_b: challenger.kpi.bookingValue,
    winner, confidence,
    notes: `auto AB compare ${periodStart} ~ ${periodEnd}`,
  });
  if (insErr) console.error('[policy-ab insert]', insErr.message);

  // winner 판정 시 admin alert (활성 전환 추천)
  if (winner && winner !== active.id) {
    const winnerVersion = winner === challenger.policy.id ? challenger.policy.version : active.version;
    // 신뢰도 95%+ 시 critical (즉시 Slack 푸시 + 강조)
    const isStrongWinner = confidence >= 0.05; // booking_rate 차이 5%p 이상
    await postAlert({
      category: 'policy_winner',
      severity: isStrongWinner ? 'critical' : 'warning',
      title: isStrongWinner
        ? `🚨 정책 A/B 강한 winner: ${winnerVersion} (즉시 활성 전환 권고)`
        : `정책 A/B winner 발견: ${winnerVersion}`,
      message: `현재 active(${active.version}) booking_rate ${(aRate*100).toFixed(2)}% vs challenger(${challenger.policy.version}) ${(bRate*100).toFixed(2)}%. 신뢰도 ${(confidence*100).toFixed(1)}%. ${
        isStrongWinner
          ? '자비스에 "활성 전환해" 또는 /admin/scoring 직접 전환.'
          : '/admin/scoring 에서 활성 전환 검토.'
      }`,
      ref_type: 'policy',
      ref_id: winner,
      meta: {
        active_id: active.id, challenger_id: challenger.policy.id,
        booking_rate_a: aRate, booking_rate_b: bRate, confidence,
        period_start: periodStart, period_end: periodEnd,
        strong_winner: isStrongWinner,
      },
      dedupe: true,
    });
  }

  return NextResponse.json({
    ok: true,
    active: { ...active, kpi: activeKpi, booking_rate: aRate, wilson_lower: aLower },
    challenger: { ...challenger.policy, kpi: challenger.kpi, booking_rate: bRate, wilson_lower: bLower },
    winner, confidence,
  });
}

export const GET = withCronLogging('policy-ab-compare', handle);
