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

  const dateParam = request.nextUrl.searchParams.get('date');
  const day = dateParam || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = `${day}T00:00:00.000Z`;
  const to = `${day}T23:59:59.999Z`;
  try {

    const { data: rows, error } = await supabaseAdmin
      .from('affiliate_touchpoints')
      .select('referral_code, sub_id, session_id, package_id')
      .gte('clicked_at', from)
      .lte('clicked_at', to)
      .eq('is_bot', false)
      .eq('is_duplicate', false)
      .not('referral_code', 'is', null)
      .limit(200000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const map = new Map<string, { referral_code: string; sub_id: string; clicks: number; sessions: Set<string>; packages: Set<string> }>();
    for (const r of (rows || []) as Array<{ referral_code: string; sub_id: string | null; session_id: string | null; package_id: string | null }>) {
      const referralCode = String(r.referral_code || '').trim();
      if (!referralCode) continue;
      const subId = String(r.sub_id || 'default').trim() || 'default';
      const key = `${referralCode}::${subId}`;
      if (!map.has(key)) {
        map.set(key, { referral_code: referralCode, sub_id: subId, clicks: 0, sessions: new Set<string>(), packages: new Set<string>() });
      }
      const cur = map.get(key)!;
      cur.clicks += 1;
      if (r.session_id) cur.sessions.add(r.session_id);
      if (r.package_id) cur.packages.add(r.package_id);
    }

    const payload = [...map.values()].map((v) => ({
      day,
      referral_code: v.referral_code,
      sub_id: v.sub_id,
      clicks: v.clicks,
      unique_sessions: v.sessions.size,
      touched_packages: v.packages.size,
      updated_at: new Date().toISOString(),
    }));

    if (payload.length > 0) {
      const { error: upErr } = await supabaseAdmin
        .from('affiliate_sub_attribution_daily')
        .upsert(payload as never, { onConflict: 'day,referral_code,sub_id' });
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    await reportAffiliateCronSuccess('affiliate-sub-daily-rollup', { day, rows: (rows || []).length, groups: payload.length });
    return NextResponse.json({ ok: true, day, rows: (rows || []).length, groups: payload.length });
  } catch (err) {
    await reportAffiliateCronFailure('affiliate-sub-daily-rollup', err, { day, from, to });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'affiliate sub daily rollup failed' },
      { status: 500 },
    );
  }
}

