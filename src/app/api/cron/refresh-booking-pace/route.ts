/**
 * GET /api/cron/refresh-booking-pace
 *
 * 매주 월 04:00 KST 자동 실행.
 * 최근 90일 booking 데이터로 booking_pace_aggregate 를 재빌드:
 *   - (departing_location_id × destination × dow × lead_time_bucket) 별
 *   - booking_count / cancel_count / avg_party_size / avg_sale_price
 *
 * 출력은 어드민 대시보드(/admin/demand-curve) + 가격 정책 엔진의 input.
 */
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function leadTimeBucket(days: number | null): string {
  if (days == null || !Number.isFinite(days)) return 'unknown';
  if (days <= 1) return 'D-1';
  if (days <= 3) return 'D-3';
  if (days <= 7) return 'D-7';
  if (days <= 14) return 'D-14';
  if (days <= 30) return 'D-30';
  return 'D-60+';
}

async function run() {
  if (!isSupabaseConfigured) return { ok: true, mock: true };

  const now = new Date();
  const windowStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const { data: rows } = await supabaseAdmin
    .from('bookings')
    .select('package_id, departing_location_id, departure_date, created_at, cancelled_at, adult_count, child_count, total_price, travel_packages!inner(destination)')
    .gte('created_at', windowStart.toISOString())
    .limit(50000);

  if (!rows || rows.length === 0) return { ok: true, aggregated: 0 };

  // 그룹화 키: dep_loc + dest + dow + bucket
  type Group = {
    departing_location_id: string | null;
    destination: string | null;
    departure_dow: number | null;
    lead_time_bucket: string;
    booking_count: number;
    cancel_count: number;
    party_sum: number;
    party_n: number;
    price_sum: number;
    price_n: number;
  };
  const groups = new Map<string, Group>();

  for (const r of rows as unknown as Array<{ departure_date: string; created_at: string; travel_packages: { destination: string } | null; departing_location_id: string; cancelled_at: string | null; adult_count: number; child_count: number; total_price: number }>) {
    const depDate: string | null = r.departure_date ?? null;
    const createdAt: string = r.created_at;
    let leadDays: number | null = null;
    let dow: number | null = null;
    if (depDate) {
      const dd = new Date(depDate);
      dow = dd.getUTCDay();
      leadDays = Math.round((dd.getTime() - new Date(createdAt).getTime()) / 86400000);
    }
    const dest = r.travel_packages?.destination ?? null;
    const depLoc = r.departing_location_id ?? null;
    const bucket = leadTimeBucket(leadDays);
    const key = `${depLoc ?? '-'}|${dest ?? '-'}|${dow ?? -1}|${bucket}`;
    const grp = groups.get(key) ?? {
      departing_location_id: depLoc,
      destination: dest,
      departure_dow: dow,
      lead_time_bucket: bucket,
      booking_count: 0,
      cancel_count: 0,
      party_sum: 0,
      party_n: 0,
      price_sum: 0,
      price_n: 0,
    };
    if (r.cancelled_at) {
      grp.cancel_count += 1;
    } else {
      grp.booking_count += 1;
    }
    const party = (r.adult_count ?? 0) + (r.child_count ?? 0);
    if (party > 0) {
      grp.party_sum += party;
      grp.party_n += 1;
    }
    if (typeof r.total_price === 'number' && r.total_price > 0) {
      grp.price_sum += r.total_price;
      grp.price_n += 1;
    }
    groups.set(key, grp);
  }

  const windowStartDate = windowStart.toISOString().slice(0, 10);
  const windowEndDate = now.toISOString().slice(0, 10);

  const upsertRows = Array.from(groups.values()).map((g) => ({
    departing_location_id: g.departing_location_id,
    destination: g.destination,
    departure_dow: g.departure_dow,
    lead_time_bucket: g.lead_time_bucket,
    booking_count: g.booking_count,
    cancel_count: g.cancel_count,
    avg_party_size: g.party_n > 0 ? Math.round((g.party_sum / g.party_n) * 100) / 100 : null,
    avg_sale_price: g.price_n > 0 ? Math.round((g.price_sum / g.price_n) * 100) / 100 : null,
    sample_window_start: windowStartDate,
    sample_window_end: windowEndDate,
    refreshed_at: new Date().toISOString(),
  }));

  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < upsertRows.length; i += CHUNK) {
    const slice = upsertRows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from('booking_pace_aggregate')
      .upsert(slice as never, {
        onConflict: 'departing_location_id,destination,departure_dow,lead_time_bucket,sample_window_start',
      });
    if (error) {
      console.warn('[refresh-booking-pace] chunk 실패:', error.message);
    } else {
      written += slice.length;
    }
  }

  return { ok: true, aggregated: written, source_rows: rows.length };
}

export const GET = withCronLogging('refresh-booking-pace', async (request) => {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();
  return run();
});
