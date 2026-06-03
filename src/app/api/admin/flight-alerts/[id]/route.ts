import { NextRequest, type NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { logAndSanitize } from '@/lib/error-sanitizer';
import { sendSlackAlert } from '@/lib/slack-alert';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const patchHandler = async (
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  const { id } = params;
  if (!id) {
    return apiResponse({ error: 'ID_REQUIRED' }, { status: 400 });
  }

  try {
    let body: {
      status?: string;
      delayMinutes?: number;
      actualDeparture?: string;
      note?: string;
      notifiedCustomer?: boolean;
      notifiedOperator?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {};
    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.delayMinutes !== undefined) updatePayload.delay_minutes = body.delayMinutes;
    if (body.actualDeparture !== undefined) updatePayload.actual_departure = body.actualDeparture;
    if (body.note !== undefined) updatePayload.note = body.note;
    if (body.notifiedCustomer !== undefined) updatePayload.notified_customer = body.notifiedCustomer;
    if (body.notifiedOperator !== undefined) updatePayload.notified_operator = body.notifiedOperator;

    if (Object.keys(updatePayload).length === 0) {
      return apiResponse({ error: 'NO_FIELDS_TO_UPDATE' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('flight_alerts')
      .select('flight_number, route, scheduled_departure, status')
      .eq('id', id)
      .limit(1);

    if (existingError) throw existingError;

    const { error } = await supabaseAdmin
      .from('flight_alerts')
      .update(updatePayload)
      .eq('id', id);

    if (error) throw error;

    const newStatus = body.status;
    if (newStatus === 'delayed' || newStatus === 'cancelled') {
      const flight = existing?.[0];
      const label = newStatus === 'cancelled' ? 'cancelled' : `delayed ${body.delayMinutes ?? '?'}m`;
      await sendSlackAlert(
        `Flight status changed to ${label}: ${flight?.flight_number ?? id} (${flight?.route ?? ''})`,
        {
          flight_id: id,
          scheduled: flight?.scheduled_departure,
          previous_status: flight?.status,
          new_status: newStatus,
          note: body.note ?? null,
        },
      );
    }

    return apiResponse({ ok: true });
  } catch (err) {
    return apiResponse(
      { error: logAndSanitize('admin-flight-alerts-patch', err, 'REQUEST_FAILED') },
      { status: 500 },
    );
  }
};

export const PATCH = withAdminGuard(patchHandler);
