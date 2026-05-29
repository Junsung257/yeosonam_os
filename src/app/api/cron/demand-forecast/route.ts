/**
 * GET /api/cron/demand-forecast
 *
 * 매주 화 05:00 KST. 수요 예측 베이스라인 모델 실행.
 *
 * 현재 구현 — **간단 baseline**:
 *   - 입력: booking_pace_aggregate(최근 90일)
 *   - 모델: 최근 4주 평균 × 시즌성 가중치(destination_climate.popularity_score)
 *   - 출력: demand_forecast (forecast_date = 향후 30/60/90일 출발)
 *
 * 추후 (Phase 4):
 *   - Prophet 또는 Statsmodels(SARIMAX) 모델로 교체
 *   - flight_availability + ota_price_snapshots 외부신호 feature 추가
 *   - charter_recommendation 산식: expected_bookings × avg_party_size ≥ 80 → 'recommended'
 */
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const MODEL_NAME = 'baseline_v1';
const HORIZONS = [30, 60, 90];

interface PaceRow {
  destination: string | null;
  departure_dow: number | null;
  lead_time_bucket: string;
  booking_count: number;
  avg_party_size: number | null;
  avg_sale_price: number | null;
}

async function run() {
  if (!isSupabaseConfigured) return { ok: true, mock: true };

  const { data: paceRows } = await supabaseAdmin
    .from('booking_pace_aggregate')
    .select('destination, departure_dow, lead_time_bucket, booking_count, avg_party_size, avg_sale_price')
    .order('refreshed_at', { ascending: false })
    .limit(5000);

  if (!paceRows || paceRows.length === 0) {
    return { ok: true, skipped: true, reason: 'booking_pace_aggregate 비어있음 — refresh-booking-pace 먼저 실행 필요' };
  }

  // 목적지 별 집계
  const byDest = new Map<string, { booking_total: number; party_avg: number; price_avg: number; samples: number }>();
  for (const r of paceRows as PaceRow[]) {
    if (!r.destination) continue;
    const agg = byDest.get(r.destination) ?? { booking_total: 0, party_avg: 0, price_avg: 0, samples: 0 };
    agg.booking_total += r.booking_count;
    if (r.avg_party_size != null) {
      agg.party_avg = (agg.party_avg * agg.samples + r.avg_party_size) / (agg.samples + 1);
    }
    if (r.avg_sale_price != null) {
      agg.price_avg = (agg.price_avg * agg.samples + r.avg_sale_price) / (agg.samples + 1);
    }
    agg.samples += 1;
    byDest.set(r.destination, agg);
  }

  // 목적지 시즌성 가중치
  const { data: climateRows } = await supabaseAdmin
    .from('destination_climate')
    .select('destination, seasonal_signals')
    .limit(2000);
  const seasonalByDest = new Map<string, any>();
  for (const c of (climateRows ?? []) as unknown as Array<Record<string, unknown>>) {
    seasonalByDest.set(c.destination as string, c.seasonal_signals ?? null);
  }

  const now = new Date();
  const generatedAt = now.toISOString();
  const inserts: any[] = [];

  for (const [destination, agg] of byDest.entries()) {
    // 90일 → 일평균
    const dailyBaseline = agg.booking_total / 90;

    for (const horizon of HORIZONS) {
      const target = new Date(now.getTime() + horizon * 86400000);
      const month = target.getUTCMonth() + 1;  // 1..12
      const signals = seasonalByDest.get(destination);
      let seasonalMultiplier = 1.0;
      // popularity_score 가 월별 객체이면 활용
      try {
        if (signals && Array.isArray(signals.popularity_score)) {
          const score = signals.popularity_score[month - 1];
          if (typeof score === 'number' && score > 0) {
            seasonalMultiplier = Math.max(0.5, Math.min(2.5, score / 50));
          }
        }
      } catch {
        seasonalMultiplier = 1.0;
      }

      const expected = dailyBaseline * horizon * seasonalMultiplier;
      const partyAvg = agg.party_avg > 0 ? agg.party_avg : 2.5;
      const expectedSeats = expected * partyAvg;
      const expectedRevenue = expected * (agg.price_avg || 0);

      // charter_recommendation: 80석 베이스라인 (180석 전세기의 절반 채우면 손익 분기 추정)
      let charter: string = 'unknown';
      if (expectedSeats >= 120) charter = 'recommended';
      else if (expectedSeats >= 60) charter = 'marginal';
      else if (dailyBaseline > 0) charter = 'not_recommended';

      inserts.push({
        generated_at: generatedAt,
        model_name: MODEL_NAME,
        model_version: '1',
        destination,
        forecast_date: target.toISOString().slice(0, 10),
        horizon_days: horizon,
        expected_bookings: Math.round(expected * 100) / 100,
        expected_revenue_krw: Math.round(expectedRevenue * 100) / 100,
        confidence_lower: Math.round(expected * 0.7 * 100) / 100,
        confidence_upper: Math.round(expected * 1.3 * 100) / 100,
        feature_snapshot: {
          dailyBaseline,
          seasonalMultiplier,
          partyAvg,
          priceAvg: agg.price_avg,
          model: MODEL_NAME,
        },
        charter_recommendation: charter,
        charter_breakeven_seats: 120,
      });
    }
  }

  // 일괄 적재
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const slice = inserts.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin.from('demand_forecast_v2').insert(slice as never);
    if (error) console.warn('[demand-forecast] chunk 실패:', error.message);
    else inserted += slice.length;
  }

  return { ok: true, forecasts: inserted, destinations: byDest.size };
}

export const GET = withCronLogging('demand-forecast', async (request) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return run();
});
