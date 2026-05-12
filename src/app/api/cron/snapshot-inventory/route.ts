/**
 * GET /api/cron/snapshot-inventory
 *
 * 매일 03:00 KST (18:00 UTC 전일) 자동 실행.
 * daily_inventory_snapshots 에 모든 활성 패키지의 일일 재고·수요 스냅샷을 1행씩 적재.
 *
 * 입력 (전일 데이터):
 *   - travel_packages: 가격·시트 마스터
 *   - bookings: 신규/취소 카운트
 *   - ad_engagement_logs: 'product_view' 카운트
 *   - ad_search_logs: search_query 매칭 카운트
 *   - conversations.journey: QA mention 카운트 (옵션)
 *
 * 출력:
 *   - daily_inventory_snapshots 1 row per (package, departure_date)
 *
 * 멱등성: UNIQUE(snapshot_date, package_id, departure_date) — 재실행 시 ON CONFLICT 무시
 *
 * NOTE: 이건 "스켈레톤" — 실제 view/search 카운트 추출은 GIN 인덱스나 사전 MV 필요.
 *       초기 운영에서는 seats / bookings 만 채워도 가치 있음. 나머지는 점진적 보강.
 */
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function run() {
  if (!isSupabaseConfigured) {
    return { ok: true, mock: true, snapshots: 0 };
  }

  const now = new Date();
  const snapshotDate = yyyymmdd(now);
  const yesterdayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  yesterdayStart.setUTCHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(yesterdayStart.getTime() + 24 * 60 * 60 * 1000);

  // 활성 패키지 로드 (status=approved 또는 active)
  const { data: pkgs } = await supabaseAdmin
    .from('travel_packages')
    .select('id, destination, price, cost_price, seats_held, seats_confirmed, seats_ticketed, status, departure_date, departing_location_id, is_active')
    .eq('is_active', true)
    .in('status', ['approved', 'active', 'live'])
    .limit(2000);

  if (!pkgs || pkgs.length === 0) {
    return { ok: true, snapshots: 0, reason: 'no_active_packages' };
  }

  // 전일 신규/취소 booking 집계 (package 별)
  const { data: bookingRows } = await supabaseAdmin
    .from('bookings')
    .select('package_id, status, cancelled_at, created_at')
    .gte('created_at', yesterdayStart.toISOString())
    .lt('created_at', yesterdayEnd.toISOString());

  const newCountByPkg = new Map<string, number>();
  const cancelCountByPkg = new Map<string, number>();
  for (const b of (bookingRows ?? []) as { package_id: string; cancelled_at: string | null }[]) {
    if (!b.package_id) continue;
    if (b.cancelled_at) {
      cancelCountByPkg.set(b.package_id, (cancelCountByPkg.get(b.package_id) ?? 0) + 1);
    } else {
      newCountByPkg.set(b.package_id, (newCountByPkg.get(b.package_id) ?? 0) + 1);
    }
  }

  // 전일 product_view 집계 (ad_engagement_logs)
  const { data: viewRows } = await supabaseAdmin
    .from('ad_engagement_logs')
    .select('product_id')
    .eq('event_type', 'product_view')
    .gte('created_at', yesterdayStart.toISOString())
    .lt('created_at', yesterdayEnd.toISOString())
    .limit(50000);
  const viewByPkg = new Map<string, number>();
  for (const v of (viewRows ?? []) as { product_id: string | null }[]) {
    if (!v.product_id) continue;
    viewByPkg.set(v.product_id, (viewByPkg.get(v.product_id) ?? 0) + 1);
  }

  // 스냅샷 row 구성
  const rows = pkgs.map((p: any) => {
    const seatsTotal: number | null =
      typeof p.seats_held === 'number' ? p.seats_held : null;
    const seatsBooked: number | null =
      typeof p.seats_confirmed === 'number' ? p.seats_confirmed : null;
    const seatsTicketed: number | null =
      typeof p.seats_ticketed === 'number' ? p.seats_ticketed : null;
    const occupancy =
      seatsTotal && seatsTotal > 0 && seatsBooked != null
        ? Math.round((seatsBooked / seatsTotal) * 10000) / 100
        : null;
    let daysToDeparture: number | null = null;
    if (p.departure_date) {
      const diffMs = new Date(p.departure_date as string).getTime() - now.getTime();
      daysToDeparture = Math.round(diffMs / 86400000);
    }
    return {
      snapshot_date: snapshotDate,
      package_id: p.id as string,
      departure_date: (p.departure_date as string) ?? null,
      destination: (p.destination as string) ?? null,
      departing_location_id: (p.departing_location_id as string) ?? null,
      seats_total: seatsTotal,
      seats_held: seatsTotal,
      seats_booked: seatsBooked,
      seats_ticketed: seatsTicketed,
      current_price: typeof p.price === 'number' ? p.price : null,
      cost_price: typeof p.cost_price === 'number' ? p.cost_price : null,
      daily_views: viewByPkg.get(p.id as string) ?? 0,
      daily_new_bookings: newCountByPkg.get(p.id as string) ?? 0,
      daily_cancellations: cancelCountByPkg.get(p.id as string) ?? 0,
      occupancy_rate: occupancy,
      days_to_departure: daysToDeparture,
    };
  });

  // 배치 upsert (UNIQUE 키로 멱등)
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from('daily_inventory_snapshots')
      .upsert(slice as never, {
        onConflict: 'snapshot_date,package_id,departure_date',
        ignoreDuplicates: true,
      });
    if (error) {
      console.warn('[snapshot-inventory] chunk upsert 실패:', error.message);
    } else {
      inserted += slice.length;
    }
  }

  return { ok: true, snapshots: inserted, packages: pkgs.length };
}

export const GET = withCronLogging('snapshot-inventory', async (request) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return run();
});
