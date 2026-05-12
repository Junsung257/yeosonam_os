import { supabaseAdmin } from '@/lib/supabase';
import type { TravelItinerary } from '@/types/itinerary';

const MIN_SAMPLES = 2;
const ROUND_TO = 1000;

export interface LearnMarketRatesResult {
  scanned_packages: number;
  options_seen: number;
  upserted: number;
  computed_at: string;
}

/**
 * 옵션관광 시장가 자동 학습.
 *
 * 모든 active 패키지의 itinerary_data.optional_tours[] 가격을 모아
 * (destination + tour_name) 그룹별 평균을 산출 → optional_tour_market_rates UPSERT.
 *
 * source='cron-learned' 표시. 사장님 수동 입력은 source='manual' 로 남아 우선됨.
 */
export async function learnMarketRates(): Promise<LearnMarketRatesResult> {
  const { data, error } = await supabaseAdmin
    .from('travel_packages')
    .select('destination, itinerary_data')
    .in('status', ['approved', 'active']);
  if (error) throw new Error(`패키지 조회 실패: ${error.message}`);
  type Row = { destination: string; itinerary_data: TravelItinerary | null };
  const packages = (data ?? []) as Row[];

  // (dest|name) 또는 (name) 키별 sum/count 누적
  const buckets = new Map<string, { sum: number; n: number; dest: string | null; name: string }>();
  for (const p of packages) {
    const tours = p.itinerary_data?.optional_tours ?? [];
    for (const t of tours) {
      if (!t.name || typeof t.price_krw !== 'number' || t.price_krw <= 0) continue;
      const keys = [`${p.destination}|${t.name}`, `__global__|${t.name}`];
      for (const k of keys) {
        if (!buckets.has(k)) {
          buckets.set(k, {
            sum: 0, n: 0,
            dest: k.startsWith('__global__|') ? null : p.destination,
            name: t.name,
          });
        }
        const b = buckets.get(k)!;
        b.sum += t.price_krw;
        b.n++;
      }
    }
  }

  const computedAt = new Date().toISOString();
  let upserted = 0;

  // 사장님 수동 입력(manual)은 덮지 않음 — cron-learned 만 갱신
  const { data: manualData } = await supabaseAdmin
    .from('optional_tour_market_rates')
    .select('tour_name, destination, source');
  const manualKeys = new Set<string>();
  for (const m of (manualData ?? []) as Array<{ tour_name: string; destination: string | null; source: string }>) {
    if (m.source === 'manual') manualKeys.add(`${m.destination ?? ''}|${m.tour_name}`);
  }

  for (const b of buckets.values()) {
    if (b.n < MIN_SAMPLES) continue;
    const skipKey = `${b.dest ?? ''}|${b.name}`;
    if (manualKeys.has(skipKey)) continue;

    const avg = Math.round(b.sum / b.n / ROUND_TO) * ROUND_TO;
    const { error: upErr } = await supabaseAdmin
      .from('optional_tour_market_rates')
      .upsert({
        tour_name: b.name,
        destination: b.dest,
        market_rate_krw: avg,
        source: 'cron-learned',
        sample_size: b.n,
        notes: `자동 학습 (${computedAt.slice(0, 10)})`,
      }, { onConflict: 'tour_name,destination' });
    if (upErr) {
      console.error(`[learn-market-rates] ${b.name} upsert 실패:`, upErr.message);
      continue;
    }
    upserted++;
  }

  return {
    scanned_packages: packages.length,
    options_seen: buckets.size,
    upserted,
    computed_at: computedAt,
  };
}
