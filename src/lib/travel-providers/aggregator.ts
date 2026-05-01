/**
 * travel-providers/aggregator.ts
 *
 * Multi-OTA 가격 비교 집계 엔진.
 * - 모든 활성 provider에 동시 검색 (Promise.allSettled)
 * - 카테고리별 타임아웃 적용 (항공 6s / 숙박 5s / 액티비티 5s)
 * - fulfilled 결과만 집계, rejected/timeout은 providerErrors에 기록
 * - 결과: 가격 오름차순 정렬
 */

import type {
  TravelProvider,
  FlightSearchParams,
  FlightResult,
  StaySearchParams,
  StayResult,
  ActivitySearchParams,
  ActivityResult,
  AggregatedResults,
  ProviderName,
} from './types';
import { supabaseAdmin } from '@/lib/supabase';

const TIMEOUT_MS = {
  flight: 6000,
  hotel: 5000,
  activity: 5000,
} as const;

function withTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, ms);
  return factory(controller.signal)
    .catch(err => {
      if (didTimeout) {
        throw new Error(`${label} provider timeout (${ms}ms)`);
      }
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

export class TravelAggregator {
  constructor(private readonly providers: TravelProvider[]) {}

  // ─── 항공 검색 ──────────────────────────────────────────────────────────────

  async searchFlights(params: FlightSearchParams): Promise<{
    results: FlightResult[];
    errors: { provider: ProviderName; error: string }[];
  }> {
    const active = this.providers.filter(p => p.supports.includes('flight'));
    const settled = await Promise.allSettled(
      active.map(p =>
        withTimeout(signal => p.searchFlights({ ...params, signal }), TIMEOUT_MS.flight, p.name),
      ),
    );

    const results: FlightResult[] = [];
    const errors: { provider: ProviderName; error: string }[] = [];

    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        results.push(...r.value);
      } else {
        errors.push({ provider: active[i].name, error: r.reason?.message ?? '알 수 없는 오류' });
      }
    });

    results.sort((a, b) => a.price - b.price);
    return { results, errors };
  }

  // ─── 숙박 검색 ──────────────────────────────────────────────────────────────

  async searchStays(params: StaySearchParams): Promise<{
    results: StayResult[];
    errors: { provider: ProviderName; error: string }[];
  }> {
    const active = this.providers.filter(p => p.supports.includes('hotel'));
    const settled = await Promise.allSettled(
      active.map(p =>
        withTimeout(signal => p.searchStays({ ...params, signal }), TIMEOUT_MS.hotel, p.name),
      ),
    );

    const results: StayResult[] = [];
    const errors: { provider: ProviderName; error: string }[] = [];

    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        results.push(...r.value);
      } else {
        errors.push({ provider: active[i].name, error: r.reason?.message ?? '알 수 없는 오류' });
      }
    });

    results.sort((a, b) => a.pricePerNight - b.pricePerNight);
    return { results, errors };
  }

  // ─── 액티비티 검색 ──────────────────────────────────────────────────────────

  async searchActivities(params: ActivitySearchParams): Promise<{
    results: ActivityResult[];
    errors: { provider: ProviderName; error: string }[];
  }> {
    const active = this.providers.filter(p => p.supports.includes('activity'));
    const settled = await Promise.allSettled(
      active.map(p =>
        withTimeout(signal => p.searchActivities({ ...params, signal }), TIMEOUT_MS.activity, p.name),
      ),
    );

    const results: ActivityResult[] = [];
    const errors: { provider: ProviderName; error: string }[] = [];

    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        results.push(...r.value);
      } else {
        errors.push({ provider: active[i].name, error: r.reason?.message ?? '알 수 없는 오류' });
      }
    });

    results.sort((a, b) => a.price - b.price);
    return { results, errors };
  }

  // ─── 통합 검색 (항공 + 숙박 + 액티비티 동시) ─────────────────────────────

  async searchAll(
    flightParams: FlightSearchParams,
    stayParams: StaySearchParams,
    activityParams: ActivitySearchParams,
  ): Promise<AggregatedResults> {
    const startMs = Date.now();

    const [flightRes, stayRes, activityRes] = await Promise.all([
      this.searchFlights(flightParams),
      this.searchStays(stayParams),
      this.searchActivities(activityParams),
    ]);

    const allErrors = [
      ...flightRes.errors,
      ...stayRes.errors,
      ...activityRes.errors,
    ];

    return {
      flights:          flightRes.results,
      hotels:           stayRes.results,
      activities:       activityRes.results,
      providersQueried: [...new Set(this.providers.map(p => p.name))],
      providerErrors:   allErrors,
      searchDurationMs: Date.now() - startMs,
    };
  }

  // ─── Fallback: 여소남 패키지 비교 (Decoy Effect) ──────────────────────────

  async getFallbackPackages(destination: string, limit = 3) {
    if (!supabaseAdmin) return [];

    const { data } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, price_adult, destination, product_highlights')
      .ilike('destination', `%${destination}%`)
      .eq('is_active', true)
      .eq('status', 'approved')
      .order('price_adult', { ascending: true })
      .limit(limit);

    return data ?? [];
  }
}
