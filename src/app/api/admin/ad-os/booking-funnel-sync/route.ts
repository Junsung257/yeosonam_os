import { NextRequest, NextResponse } from 'next/server';
import { normalizeFunnelEvent } from '@/lib/ad-os-v13-v18';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase is not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const apply = body.apply !== false;
  const days = Math.min(Math.max(Number(body.days || 30), 1), 365);
  const limit = Math.min(Math.max(Number(body.limit || 500), 1), 2000);

  const { data: run, error: runError } = await supabaseAdmin
    .from('ad_os_automation_runs')
    .insert({
      run_type: 'performance_sync',
      mode: apply ? 'guarded' : 'dry_run',
      status: 'running',
      summary: { source: 'booking_funnel_sync_v14', apply, days, limit },
    })
    .select('id')
    .single();

  if (runError || !run) {
    return NextResponse.json({ ok: false, error: runError?.message || 'run create failed' }, { status: 500 });
  }

  const { data: bookings, error } = await supabaseAdmin
    .from('bookings')
    .select('id,tenant_id,package_id,status,total_price,total_cost,paid_amount,created_at,updated_at,cancelled_at,settlement_confirmed_at,utm_source,utm_medium,utm_campaign,utm_content,utm_term,referral_code')
    .gte('updated_at', sinceIso(days))
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    await supabaseAdmin
      .from('ad_os_automation_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: error.message }] })
      .eq('id', run.id);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (bookings || []).flatMap((booking: any) => {
    const revenue = Math.max(Number(booking.paid_amount || 0), Number(booking.total_price || 0));
    const margin = Number(booking.total_price || 0) - Number(booking.total_cost || 0);
    const platform = booking.utm_source && ['naver', 'google', 'meta', 'kakao'].includes(String(booking.utm_source))
      ? String(booking.utm_source)
      : 'organic';
    const base = {
      platform: platform as 'naver' | 'google' | 'meta' | 'kakao' | 'organic',
      productId: booking.package_id || null,
      bookingId: booking.id,
      revenueKrw: revenue,
      marginKrw: margin,
      costKrw: 0,
      rawPayload: {
        status: booking.status,
        utm_source: booking.utm_source,
        utm_medium: booking.utm_medium,
        utm_campaign: booking.utm_campaign,
        utm_content: booking.utm_content,
        utm_term: booking.utm_term,
        referral_code: booking.referral_code,
      },
    };

    const eventTypes = ['booking'];
    if (booking.cancelled_at || String(booking.status || '').toLowerCase().includes('cancel')) eventTypes.push('cancel');
    if (booking.settlement_confirmed_at) eventTypes.push('settlement_confirmed');

    return eventTypes.map((eventType) => {
      const normalized = normalizeFunnelEvent({ ...base, eventType });
      return {
        tenant_id: booking.tenant_id || null,
        event_type: normalized.event_type,
        event_time: eventType === 'cancel'
          ? booking.cancelled_at || booking.updated_at
          : eventType === 'settlement_confirmed'
            ? booking.settlement_confirmed_at
            : booking.created_at,
        platform: normalized.platform,
        source: 'booking_funnel_sync_v14',
        product_id: normalized.product_id,
        booking_id: normalized.booking_id,
        revenue_krw: eventType === 'cancel' ? 0 : normalized.revenue_krw,
        margin_krw: eventType === 'cancel' ? 0 : normalized.margin_krw,
        cost_krw: 0,
        utm_source: booking.utm_source || null,
        utm_medium: booking.utm_medium || null,
        utm_campaign: booking.utm_campaign || null,
        utm_content: booking.utm_content || null,
        utm_term: booking.utm_term || null,
        quarantine_status: normalized.quarantine_status,
        quality_flags: {
          ...normalized.quality_flags,
          run_id: run.id,
          booking_status: booking.status,
          excluded_from_learning: normalized.excluded_from_learning,
        },
        raw_payload: {
          ...base.rawPayload,
          event_type: eventType,
          booking_id: booking.id,
        },
      };
    });
  });

  if (apply && rows.length > 0) {
    const { error: insertError } = await supabaseAdmin.from('ad_os_conversion_events').insert(rows);
    if (insertError) {
      await supabaseAdmin
        .from('ad_os_automation_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString(), errors: [{ message: insertError.message }] })
        .eq('id', run.id);
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }
  }

  const summary = {
    apply,
    days,
    bookings_checked: bookings?.length || 0,
    events_prepared: rows.length,
    booking_events: rows.filter((row) => row.event_type === 'booking').length,
    cancel_events: rows.filter((row) => row.event_type === 'cancel').length,
    settlement_events: rows.filter((row) => row.event_type === 'settlement_confirmed').length,
    revenue_krw: rows.reduce((sum, row) => sum + Number(row.revenue_krw || 0), 0),
    margin_krw: rows.reduce((sum, row) => sum + Number(row.margin_krw || 0), 0),
  };

  await supabaseAdmin
    .from('ad_os_automation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), summary })
    .eq('id', run.id);

  return NextResponse.json({ ok: true, run_id: run.id, summary, sample: rows.slice(0, 20) });
});
