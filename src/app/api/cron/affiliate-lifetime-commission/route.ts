import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, skipped: 'DB 미설정' });
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  const sinceDays = Number(request.nextUrl.searchParams.get('days') || '60');
  const since = new Date(Date.now() - Math.max(1, sinceDays) * 24 * 60 * 60 * 1000).toISOString();
  try {

    const { data: bookings, error } = await supabaseAdmin
      .from('bookings')
      .select('id, lead_customer_id, affiliate_id, total_price, influencer_commission, lifetime_commission, created_at')
      .gte('created_at', since)
      .or('is_deleted.is.null,is_deleted.eq.false')
      .limit(3000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let applied = 0;
    for (const b of (bookings || []) as Array<{
      id: string;
      lead_customer_id: string | null;
      affiliate_id: string | null;
      total_price: number | null;
      lifetime_commission: number | null;
    }>) {
      if (!b.lead_customer_id) continue;
      if ((b.lifetime_commission || 0) > 0) continue;

      const { data: links } = await supabaseAdmin
        .from('affiliate_lifetime_links')
        .select('affiliate_id, experiment_group')
        .eq('customer_id', b.lead_customer_id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1);
      const first = (links || [])[0] as { affiliate_id: string; experiment_group: string } | undefined;
      if (!first) continue;
      if (first.experiment_group !== 'lifetime_0_5') continue;
      if (b.affiliate_id && b.affiliate_id === first.affiliate_id) continue;

      const amount = Math.max(0, Math.round((Number(b.total_price) || 0) * 0.005));
      if (amount <= 0) continue;

      const { error: upErr } = await supabaseAdmin
        .from('bookings')
        .update({
          lifetime_commission: amount,
          attribution_split: {
            model: 'lifetime_0_5',
            affiliate_id: first.affiliate_id,
            amount,
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', b.id);
      if (upErr) continue;

      await supabaseAdmin.from('affiliate_reward_events').insert({
        affiliate_id: first.affiliate_id,
        event_type: 'lifetime_commission',
        points: 0,
        reward_amount: amount,
        payload: { booking_id: b.id, rate: 0.005 },
      } as never).then(() => {}).catch(() => {});
      applied += 1;
    }

    await reportAffiliateCronSuccess('affiliate-lifetime-commission', { checked: (bookings || []).length, applied });
    return NextResponse.json({ ok: true, checked: (bookings || []).length, applied });
  } catch (err) {
    await reportAffiliateCronFailure('affiliate-lifetime-commission', err, { sinceDays, since });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'affiliate lifetime commission failed' },
      { status: 500 },
    );
  }
}

