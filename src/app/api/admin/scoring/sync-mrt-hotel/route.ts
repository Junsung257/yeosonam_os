import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import {
  syncPackageHotelIntel,
  syncPackageHotelIntelByPackageId,
  syncStaleMrtHotelIntel,
} from '@/lib/mrt-hotel-intel';
import { pickPackageRepresentativeDate } from '@/lib/scoring/extract-features';
import type { RawPackageRow } from '@/lib/scoring/extract-features';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/admin/scoring/sync-mrt-hotel
 * body: { package_id?: string, departure_date?: string, limit?: number, stale_only?: boolean }
 * - package_id 있으면 해당 패키지만 (departure_date 없으면 price_dates 대표일)
 * - stale_only true + limit → 오래된 패키지 일괄 갱신 (크론과 동일 로직)
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  let body: {
    package_id?: string;
    departure_date?: string;
    limit?: number;
    stale_only?: boolean;
  } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    if (body.stale_only) {
      const r = await syncStaleMrtHotelIntel({
        maxPackages: typeof body.limit === 'number' ? body.limit : 30,
      });
      return NextResponse.json({ ok: true, mode: 'stale', ...r });
    }

    if (typeof body.package_id === 'string' && body.package_id) {
      if (body.departure_date) {
        const { data, error } = await supabaseAdmin
          .from('travel_packages')
          .select('id, destination, duration, itinerary_data, price_dates')
          .eq('id', body.package_id)
          .limit(1);
        if (error || !data?.[0]) {
          return NextResponse.json({ error: '패키지 없음' }, { status: 404 });
        }
        const r = await syncPackageHotelIntel(data[0] as RawPackageRow, body.departure_date);
        return NextResponse.json({ ok: true, mode: 'single', package_id: body.package_id, ...r });
      }
      await syncPackageHotelIntelByPackageId(body.package_id);
      return NextResponse.json({ ok: true, mode: 'single', package_id: body.package_id });
    }

    const lim = typeof body.limit === 'number' ? body.limit : 15;
    const { data: pkgs, error } = await supabaseAdmin
      .from('travel_packages')
      .select('id, destination, duration, itinerary_data, price_dates')
      .in('status', ['approved', 'active'])
      .not('itinerary_data', 'is', null)
      .limit(lim);

    if (error) throw error;

    let synced = 0;
    for (const row of (pkgs ?? []) as RawPackageRow[]) {
      const dep = pickPackageRepresentativeDate(row.price_dates);
      if (!dep) continue;
      await syncPackageHotelIntel(row, dep);
      synced++;
    }

    return NextResponse.json({ ok: true, mode: 'batch', attempted: (pkgs ?? []).length, synced });
  } catch (e) {
    console.error('[admin/sync-mrt-hotel]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    );
  }
}
