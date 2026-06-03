import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

type FraudQuarantineBody = {
  id?: number;
  action?: 'resolve' | 'unresolve' | 'block';
  resolved_by?: string;
  notes?: string;
};

async function getHandler(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'unresolved';

  try {
    let query = supabaseAdmin
      .from('fraud_signals_log')
      .select(`
        id, booking_id, detected_at, severity, signal_codes, signal_descs,
        auto_action, resolved_at, resolved_by, notes,
        bookings!booking_id (
          id, booking_no, total_price, status, departure_date,
          internal_memo, lead_customer_id,
          customers!lead_customer_id ( name, phone )
        )
      `)
      .order('detected_at', { ascending: false })
      .limit(100);

    if (status === 'unresolved') query = query.is('resolved_at', null);
    else if (status === 'resolved') query = query.not('resolved_at', 'is', null);

    const { data, error } = await query;
    if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

    return apiResponse({ items: data ?? [] });
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
}

async function postHandler(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'SUPABASE_NOT_CONFIGURED' }, { status: 503 });
  }

  try {
    let body: FraudQuarantineBody;
    try {
      body = await request.json() as FraudQuarantineBody;
    } catch {
      return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
    }

    if (!body.id) return apiResponse({ error: 'ID_REQUIRED' }, { status: 400 });

    if (body.action === 'unresolve') {
      const { error } = await supabaseAdmin
        .from('fraud_signals_log')
        .update({ resolved_at: null, resolved_by: null, notes: body.notes ?? null })
        .eq('id', body.id);
      if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
      return apiResponse({ ok: true, action: 'unresolved' });
    }

    if (body.action === 'block') {
      const { data: signalRow, error: signalError } = await supabaseAdmin
        .from('fraud_signals_log')
        .select('booking_id')
        .eq('id', body.id)
        .maybeSingle();
      if (signalError) return apiResponse({ error: sanitizeDbError(signalError) }, { status: 500 });

      const bookingId = (signalRow as { booking_id?: string } | null)?.booking_id;
      const { error: updateLogErr } = await supabaseAdmin
        .from('fraud_signals_log')
        .update({
          auto_action: 'blocked',
          resolved_at: new Date().toISOString(),
          resolved_by: body.resolved_by ?? 'admin',
          notes: body.notes ?? 'admin blocked',
        })
        .eq('id', body.id);
      if (updateLogErr) return apiResponse({ error: sanitizeDbError(updateLogErr) }, { status: 500 });

      if (bookingId) {
        const { error: bookingError } = await supabaseAdmin
          .from('bookings')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', bookingId);
        if (bookingError) return apiResponse({ error: sanitizeDbError(bookingError) }, { status: 500 });
      }

      return apiResponse({ ok: true, action: 'blocked', booking_id: bookingId });
    }

    const { error } = await supabaseAdmin
      .from('fraud_signals_log')
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: body.resolved_by ?? 'admin',
        notes: body.notes ?? null,
      })
      .eq('id', body.id);
    if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

    return apiResponse({ ok: true, action: 'resolved' });
  } catch (e) {
    return apiResponse({ error: sanitizeDbError(e) }, { status: 500 });
  }
}

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
