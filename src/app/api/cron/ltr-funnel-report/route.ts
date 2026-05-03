/**
 * GET /api/cron/ltr-funnel-report
 *
 * 매주 월요일 09:00 UTC — 추천 깔때기 KPI 리포트.
 * v_recommendation_funnel 집계 → 정책별 conversion rate 비교 → 사장님께 알림.
 *
 * 미래 (LTR 데이터 충분 누적 시):
 *   - LightFM/listwise rerank 학습 트리거
 *   - 정책 A/B 자동 결과 박제 (policy_ab_results 테이블)
 *
 * 현재는 stub — 데이터 누적 시작점.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { postAlert } from '@/lib/admin-alerts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ skipped: true });
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && auth !== expected) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: funnel, error } = await supabaseAdmin
    .from('v_recommendation_funnel')
    .select('*')
    .order('exposures', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 학습 데이터 양 체크
  const { count: ltrCount } = await supabaseAdmin
    .from('v_ltr_signals')
    .select('*', { count: 'exact', head: true })
    .gte('label_relevant', 0);

  const totalExposures = (funnel ?? []).reduce((s: number, r: Record<string, unknown>) => s + (Number(r.exposures) || 0), 0);
  const totalBookings = (funnel ?? []).reduce((s: number, r: Record<string, unknown>) => s + (Number(r.bookings) || 0), 0);
  const overallConv = totalExposures > 0 ? (totalBookings / totalExposures * 100).toFixed(2) : '0.00';

  const ltrReady = (ltrCount ?? 0) >= 1000;
  if (ltrReady) {
    // dedupe: 같은 ref_id (ltr_threshold_1k)로 미해결 알림 있으면 재INSERT X
    await postAlert({
      category: 'ltr_ready',
      severity: 'info',
      title: 'LTR 학습 샘플 1000건 도달',
      message: `recommendation_outcomes 누적 ${ltrCount}건. LightFM/listwise rerank 학습 트리거 가능. /api/admin/scoring/train-ltr POST로 시작 (실험 단계)`,
      ref_type: 'cron', ref_id: 'ltr_threshold_1k',
      meta: { samples: ltrCount },
      dedupe: true,
    });
  }

  return NextResponse.json({
    ok: true,
    summary: {
      total_exposures: totalExposures,
      total_bookings: totalBookings,
      overall_booking_rate_pct: Number(overallConv),
      ltr_training_samples: ltrCount ?? 0,
      ltr_ready: ltrReady,
    },
    funnel: funnel ?? [],
  });
}

export const GET = withCronLogging('ltr-funnel-report', handle);
