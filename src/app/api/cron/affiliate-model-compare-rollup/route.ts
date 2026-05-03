import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';

export const dynamic = 'force-dynamic';

const lowerBound = (arr: number[], target: number): number => {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, skipped: 'DB 미설정' });
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  const day = request.nextUrl.searchParams.get('day') || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fromIso = `${day}T00:00:00.000Z`;
  const toIso = `${day}T23:59:59.999Z`;

  try {
    const { data: affiliates } = await supabaseAdmin
      .from('affiliates')
      .select('id, referral_code');
    const referralToAffiliateId = new Map<string, string>();
    (affiliates || []).forEach((a: any) => {
      const code = String(a.referral_code || '').trim();
      if (code) referralToAffiliateId.set(code, String(a.id));
    });

    const { data: bookings, error: bErr } = await supabaseAdmin
      .from('bookings')
      .select('id, created_at, affiliate_id, influencer_commission')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .or('is_deleted.is.null,is_deleted.eq.false')
      .limit(3000);
    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

    const cmp = (bookings || []) as Array<{ created_at: string; affiliate_id: string | null; influencer_commission: number | null }>;
    let firstMatch = 0;
    let lastMatch = 0;
    let linearCandidate = 0;
    let attributionSwitchCount = 0;
    let affectedCommissionPool = 0;

    let touchpointsBatch: Array<{ clicked_at: string; referral_code: string }> = [];
    let touchpointTimes: number[] = [];
    if (cmp.length > 0) {
      const minCreatedAtMs = Math.min(...cmp.map((b) => new Date(b.created_at).getTime()));
      const maxCreatedAtMs = Math.max(...cmp.map((b) => new Date(b.created_at).getTime()));
      const touchFromIso = new Date(minCreatedAtMs - 24 * 60 * 60 * 1000).toISOString();
      const touchToIso = new Date(maxCreatedAtMs).toISOString();
      const { data: tpBatch } = await supabaseAdmin
        .from('affiliate_touchpoints')
        .select('clicked_at, referral_code')
        .gte('clicked_at', touchFromIso)
        .lte('clicked_at', touchToIso)
        .eq('is_bot', false)
        .eq('is_duplicate', false)
        .order('clicked_at', { ascending: true })
        .limit(100000);
      touchpointsBatch = (tpBatch || []) as Array<{ clicked_at: string; referral_code: string }>;
      touchpointTimes = touchpointsBatch.map((tp) => new Date(tp.clicked_at).getTime());
    }

    for (const b of cmp) {
      const createdMs = new Date(b.created_at).getTime();
      const winStartMs = createdMs - 24 * 60 * 60 * 1000;
      const startIdx = lowerBound(touchpointTimes, winStartMs);
      const endExclusive = lowerBound(touchpointTimes, createdMs + 1);
      const refs: string[] = [];
      for (let i = startIdx; i < endExclusive; i++) {
        const code = String(touchpointsBatch[i]?.referral_code || '').trim();
        if (code) refs.push(code);
      }
      if (refs.length === 0) continue;
      const unique = [...new Set(refs)];
      if (unique.length >= 2) linearCandidate += 1;
      const first = refs[0];
      const last = refs[refs.length - 1];
      if (first && last && first !== last) {
        attributionSwitchCount += 1;
        affectedCommissionPool += Number(b.influencer_commission) || 0;
      }
      if (!b.affiliate_id) continue;
      const firstAffId = first ? referralToAffiliateId.get(first) : null;
      const lastAffId = last ? referralToAffiliateId.get(last) : null;
      if (firstAffId && firstAffId === b.affiliate_id) firstMatch += 1;
      if (lastAffId && lastAffId === b.affiliate_id) lastMatch += 1;
    }

    const payload = {
      day,
      sample_size: cmp.length,
      first_touch_match_count: firstMatch,
      last_touch_match_count: lastMatch,
      linear_multi_touch_candidates: linearCandidate,
      attribution_switch_count: attributionSwitchCount,
      affected_commission_pool_krw: Math.round(affectedCommissionPool),
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabaseAdmin
      .from('affiliate_model_compare_daily')
      .upsert(payload as never, { onConflict: 'day' });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    await reportAffiliateCronSuccess('affiliate-model-compare-rollup', { day, sample_size: cmp.length });
    return NextResponse.json({ ok: true, day, payload });
  } catch (err) {
    await reportAffiliateCronFailure('affiliate-model-compare-rollup', err, { day, fromIso, toIso });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'affiliate model compare rollup failed' },
      { status: 500 },
    );
  }
}

