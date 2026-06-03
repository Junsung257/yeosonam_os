import { NextRequest, type NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { logAndSanitize } from '@/lib/error-sanitizer';
import { sendSlackAlert } from '@/lib/slack-alert';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function todayRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + 2);
  end.setHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

const getHandler = async (_request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse({ flights: [] });
  }

  try {
    const { start, end } = todayRange();

    const { data, error } = await supabaseAdmin
      .from('flight_alerts')
      .select('*')
      .gte('scheduled_departure', start)
      .lt('scheduled_departure', end)
      .order('scheduled_departure', { ascending: true });

    if (error) throw error;

    return apiResponse({ flights: data ?? [] });
  } catch (err) {
    return apiResponse(
      { error: logAndSanitize('admin-flight-alerts-get', err, 'REQUEST_FAILED') },
      { status: 500 },
    );
  }
};

const postHandler = async (request: NextRequest): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  try {
    let body: {
      bookingId?: string;
      flightNumber?: string;
      route?: string;
      scheduledDeparture?: string;
      status?: string;
      delayMinutes?: number;
      actualDeparture?: string;
      note?: string;
    };
    try {
      body = await request.json();
    } catch {
      return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
    }

    const {
      bookingId,
      flightNumber,
      route,
      scheduledDeparture,
      status = 'scheduled',
      delayMinutes,
      actualDeparture,
      note,
    } = body;

    if (!flightNumber || !route || !scheduledDeparture) {
      return apiResponse({ error: 'FLIGHT_FIELDS_REQUIRED' }, { status: 400 });
    }

    const insertPayload: Record<string, unknown> = {
      flight_number: flightNumber,
      route,
      scheduled_departure: scheduledDeparture,
      status,
      delay_minutes: delayMinutes ?? null,
      actual_departure: actualDeparture ?? null,
      note: note ?? null,
    };
    if (bookingId) insertPayload.booking_id = bookingId;

    const { data, error } = await supabaseAdmin
      .from('flight_alerts')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) throw error;

    if (status === 'delayed' || status === 'cancelled') {
      const label = status === 'cancelled' ? 'cancelled' : `delayed ${delayMinutes ?? '?'}m`;
      await sendSlackAlert(
        `Flight ${label}: ${flightNumber} (${route})`,
        {
          flight_id: data?.id,
          scheduled: scheduledDeparture,
          note: note ?? null,
        },
      );
    }

    return apiResponse({ ok: true, flight_id: data?.id }, { status: 201 });
  } catch (err) {
    return apiResponse(
      { error: logAndSanitize('admin-flight-alerts-post', err, 'REQUEST_FAILED') },
      { status: 500 },
    );
  }
};

export const GET = withAdminGuard(getHandler);

export const POST = withAdminGuard(postHandler);
