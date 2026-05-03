import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';

export const dynamic = 'force-dynamic';

type Model = 'last_touch' | 'first_touch' | 'linear';

function pickModel(): Model {
  const v = (process.env.AFFILIATE_ATTRIBUTION_MODEL || 'last_touch').trim().toLowerCase();
  if (v === 'first_touch') return 'first_touch';
  if (v === 'linear') return 'linear';
  return 'last_touch';
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, skipped: 'DB 미설정' });
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  let model = pickModel();
  const sinceDays = Number(request.nextUrl.searchParams.get('days') || '30');
  const since = new Date(Date.now() - Math.max(1, sinceDays) * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data: setting } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'affiliate_attribution_model')
      .maybeSingle();
    const settingModel = (setting as { value?: { model?: string } } | null)?.value?.model;
    if (settingModel === 'first_touch' || settingModel === 'last_touch' || settingModel === 'linear') {
      model = settingModel;
    }

    const { data: bookings, error } = await supabaseAdmin
      .from('bookings')
      .select('id, created_at, referral_code, affiliate_id, total_price, influencer_commission, attribution_model')
      .gte('created_at', since)
      .or('is_deleted.is.null,is_deleted.eq.false')
      .limit(2000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let updated = 0;
    for (const b of (bookings || []) as Array<{
      id: string;
      created_at: string;
      referral_code: string | null;
      affiliate_id: string | null;
      total_price: number | null;
      influencer_commission: number | null;
    }>) {
      const windowStart = new Date(new Date(b.created_at).getTime() - 24 * 60 * 60 * 1000).toISOString();
      const { data: touches } = await supabaseAdmin
        .from('affiliate_touchpoints')
        .select('referral_code, clicked_at, sub_id')
        .gte('clicked_at', windowStart)
        .lte('clicked_at', b.created_at)
        .eq('is_bot', false)
        .eq('is_duplicate', false)
        .not('referral_code', 'is', null)
        .order('clicked_at', { ascending: true })
        .limit(50);

      const refs: string[] = ((touches || []) as Array<{ referral_code?: string | null }>)
        .map((t: { referral_code?: string | null }) => t.referral_code || '')
        .filter((v: string) => v.length > 0);
      if (!refs.length) continue;

      let chosenRef: string | null = null;
      let split: Record<string, unknown> = { model, refs };
      if (model === 'first_touch') {
        chosenRef = refs[0];
      } else if (model === 'last_touch') {
        chosenRef = refs[refs.length - 1];
      } else {
        const uniqueRefs: string[] = [...new Set(refs)];
        const portion = uniqueRefs.length > 0 ? 1 / uniqueRefs.length : 1;
        split = {
          model,
          refs: uniqueRefs,
          portions: uniqueRefs.map((r) => ({ ref: r, weight: Number(portion.toFixed(4)) })),
        };
        chosenRef = uniqueRefs[uniqueRefs.length - 1] || null;
      }

      if (!chosenRef) continue;
      const { data: aff } = await supabaseAdmin
        .from('affiliates')
        .select('id')
        .eq('referral_code', chosenRef)
        .eq('is_active', true)
        .maybeSingle();
      if (!aff) continue;
      const affiliateId = (aff as { id: string }).id;

      const { error: upErr } = await supabaseAdmin
        .from('bookings')
        .update({
          affiliate_id: affiliateId,
          referral_code: chosenRef,
          attribution_model: model,
          attribution_split: split,
          updated_at: new Date().toISOString(),
        })
        .eq('id', b.id);
      if (!upErr) updated += 1;
    }

    await reportAffiliateCronSuccess('affiliate-attribution-recalc', { model, processed: (bookings || []).length, updated });
    return NextResponse.json({ ok: true, model, since, processed: (bookings || []).length, updated });
  } catch (err) {
    await reportAffiliateCronFailure('affiliate-attribution-recalc', err, { model, sinceDays, since });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'affiliate attribution recalc failed' },
      { status: 500 },
    );
  }
}

