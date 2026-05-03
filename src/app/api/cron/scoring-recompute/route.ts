import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { recomputeAllScores, snapshotScoreHistory } from '@/lib/scoring/recommend';
import { supabaseAdmin } from '@/lib/supabase';
import { snapshotBatch } from '@/lib/scoring/feature-snapshots';
import { fitHedonicCoefs } from '@/lib/scoring/hedonic-fit';
import { learnMarketRates } from '@/lib/scoring/learn-market-rates';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 패키지 점수 재계산 cron — 매일 새벽
 *
 * 흐름:
 *  1) 현재 정책으로 1차 점수 계산 (package_scores 캐시)
 *  2) 캐시된 features로 헤도닉 회귀 → implicit price 갱신 (scoring_policies.hedonic_coefs)
 *  3) 갱신된 정책으로 2차 점수 계산 (수렴)
 *
 * 보호: CRON_SECRET 헤더 검증 (env 미설정이면 인증 생략 — 로컬 개발용)
 */
export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ skipped: true, reason: 'Supabase 미설정' });
  }
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    // 0) 옵션 시장가 자동 학습 (점수 산출 전)
    const market = await learnMarketRates();
    // 0b) MRT 호텔 인텔 — 일부만 갱신 (외부 MCP 부하 상한)
    let mrtHotel: { attempted: number; synced: number } = { attempted: 0, synced: 0 };
    try {
      const { syncStaleMrtHotelIntel } = await import('@/lib/mrt-hotel-intel');
      mrtHotel = await syncStaleMrtHotelIntel({ maxPackages: 30, freshWithinDays: 14 });
    } catch (e) {
      console.warn('[cron/scoring-recompute] mrt hotel sync:', e instanceof Error ? e.message : e);
    }
    // 1) 1차 점수
    const first = await recomputeAllScores();
    // 2) 헤도닉 implicit price 학습
    const hedonic = await fitHedonicCoefs();
    // 3) 갱신된 정책으로 2차 수렴
    const second = await recomputeAllScores();
    // 4) 10년 자산화 — 시계열 history 스냅샷 (오늘 날짜)
    const history = await snapshotScoreHistory();
    // 5) feature_snapshots — 변경된 패키지만 INSERT (랜드사 변경 추적)
    let featureSnap = { inserted: 0, total: 0 };
    try {
      // 활성 패키지 features 일괄 추출 (recompute가 features 객체를 외부 노출 안 하므로
      // package_scores 의 캐시된 features 컬럼들로 재구성)
      const { data: scs } = await supabaseAdmin
        .from('package_scores')
        .select('package_id, duration_days, shopping_count, hotel_avg_grade, meal_count, free_option_count, is_direct_flight, breakdown')
        .order('package_id');
      const seen = new Set<string>();
      const lite: Parameters<typeof snapshotBatch>[0] = [];
      for (const r of scs ?? []) {
        if (seen.has(r.package_id)) continue;
        seen.add(r.package_id);
        lite.push({
          package_id: r.package_id, destination: '', departure_date: null,
          duration_days: r.duration_days ?? 0, list_price: 0,
          shopping_count: r.shopping_count ?? 0,
          hotel_avg_grade: r.hotel_avg_grade as number | null,
          meal_count: r.meal_count ?? 0,
          free_option_count: r.free_option_count ?? 0,
          is_direct_flight: !!r.is_direct_flight,
          land_operator_id: null, reliability_score: 0.7, days_since_created: null,
          // 아래 P1+ 는 기본값 (정확한 값은 다음 recompute에서 features 직접 export 시 통합)
          confirmation_rate: 0, free_time_ratio: 0, korean_meal_count: 0, special_meal_count: 0,
          hotel_location: null, flight_time: null,
          climate_score: 50, popularity_score: 50, itinerary: null,
        });
      }
      featureSnap = await snapshotBatch(lite);
    } catch (e) {
      console.warn('[feature-snapshot]', e instanceof Error ? e.message : 'failed');
    }
    const ms = Date.now() - startedAt;
    return NextResponse.json({
      ok: true, ms,
      market: { upserted: market.upserted, options_seen: market.options_seen },
      mrt_hotel_intel: mrtHotel,
      first: { groups: first.groups, packages: first.packages },
      history: { inserted: history.inserted },
      feature_snapshots: featureSnap,
      hedonic: {
        sample_size: hedonic.sample_size,
        computed_from: hedonic.computed_from,
        shopping_per_count: hedonic.shopping_per_count,
        meal_per_count: hedonic.meal_per_count,
        hotel_grade_step: hedonic.hotel_grade_step,
      },
      second: { groups: second.groups, packages: second.packages, version: second.policy_version },
    });
  } catch (e) {
    console.error('[cron/scoring-recompute] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
