/**
 * GET /api/cron/mrt-revenue-sync
 *
 * Sync recent MRT revenue and reservation rows, then match reservations back to
 * free-travel sessions through utmContent.
 */

import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getMrtRevenues, getMrtReservations } from '@/lib/mrt-partner-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured || !supabaseAdmin) {
    return apiResponse({ error: 'DB not configured' }, { status: 503 });
  }

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  try {
    const [revPage, resPage] = await Promise.all([
      getMrtRevenues({ startDate, endDate, pageSize: 100 }),
      getMrtReservations({
        startDate,
        endDate,
        statuses: ['confirmed', 'completed'],
        pageSize: 100,
      }),
    ]);

    const revenues = revPage?.items ?? [];
    const reservations = resPage?.items ?? [];

    const sessionIds = [
      ...(revenues.map((r) => r.utmContent).filter(Boolean) as string[]),
      ...(reservations.map((r) => r.utmContent).filter(Boolean) as string[]),
    ];
    const uniqueSessionIds = [...new Set(sessionIds)];

    let matched = 0;
    let errors = 0;

    for (const sessionId of uniqueSessionIds) {
      const rev = reservations.find((r) => r.utmContent === sessionId);
      const rvn = revenues.find((r) => r.utmContent === sessionId);

      const mrtRef = rev?.reservationNo ?? rvn?.reservationNo ?? null;
      const newStatus = rev ? 'booked' : undefined;

      if (!mrtRef && !newStatus) continue;

      const updatePayload: Record<string, unknown> = {};
      if (mrtRef) updatePayload.mrt_booking_ref = mrtRef;
      if (newStatus) updatePayload.status = newStatus;
      if (mrtRef) {
        updatePayload.booked_at = rev?.reservedAt ?? rvn?.reservedAt ?? new Date().toISOString();
      }

      const { error } = await supabaseAdmin
        .from('free_travel_sessions')
        .update(updatePayload)
        .eq('id', sessionId)
        .eq('status', 'new');

      if (error) {
        errors++;
      } else {
        matched++;
      }
    }

    const totalCommission = revenues.reduce((sum, row) => sum + (row.commission ?? 0), 0);

    return apiResponse({
      ok: true,
      period: { startDate, endDate },
      revenues: revenues.length,
      reservations: reservations.length,
      sessionMatched: matched,
      errors,
      totalCommission,
    });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, 'MRT revenue sync failed') }, { status: 500 });
  }
}
