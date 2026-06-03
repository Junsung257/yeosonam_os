import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  syncPackageHotelIntel,
  syncPackageHotelIntelByPackageId,
  syncStaleMrtHotelIntel,
} from '@/lib/mrt-hotel-intel';
import { pickPackageRepresentativeDate, type RawPackageRow } from '@/lib/scoring/extract-features';
import { logError } from '@/lib/sentry-logger';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
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
      return apiResponse({ ok: true, mode: 'stale', ...r });
    }

    if (typeof body.package_id === 'string' && body.package_id) {
      if (body.departure_date) {
        const { data, error } = await supabaseAdmin
          .from('travel_packages')
          .select('id, destination, duration, itinerary_data, price_dates')
          .eq('id', body.package_id)
          .limit(1);

        if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
        if (!data?.[0]) return apiResponse({ error: 'PACKAGE_NOT_FOUND' }, { status: 404 });

        const r = await syncPackageHotelIntel(data[0] as RawPackageRow, body.departure_date);
        return apiResponse({ ok: true, mode: 'single', package_id: body.package_id, ...r });
      }

      await syncPackageHotelIntelByPackageId(body.package_id);
      return apiResponse({ ok: true, mode: 'single', package_id: body.package_id });
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

    return apiResponse({ ok: true, mode: 'batch', attempted: (pkgs ?? []).length, synced });
  } catch (e) {
    logError('[admin/scoring/sync-mrt-hotel] sync failed', e);
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
};

export const POST = withAdminGuard(postHandler);
