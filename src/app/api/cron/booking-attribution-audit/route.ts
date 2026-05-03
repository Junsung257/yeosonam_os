import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * 최근 예약 중 UTM 스냅샷이 비어 있는데 제휴/콘텐츠 귀속 신호만 있는 행을 점검한다.
 * (무결성 알림용 — 자동 수정은 하지 않음)
 */
async function runAudit(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    const res = NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정' };
  }

  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from('bookings')
    .select('id, booking_no, utm_source, utm_medium, utm_campaign, affiliate_id, content_creative_id, referral_code, created_at')
    .gte('created_at', since)
    .is('utm_source', null)
    .limit(800);

  if (error) {
    return { ok: false, error: error.message, errors: [error.message] };
  }

  type Row = {
    id: string;
    affiliate_id: string | null;
    content_creative_id: string | null;
    referral_code: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
  };

  const flagged = (rows || []).filter((r: Row) =>
    !!(r.affiliate_id || r.content_creative_id || r.referral_code),
  );
  const suspiciousNoMedium = flagged.filter((r: Row) => !r.utm_medium);

  // 자동수정은 "환경변수 + 요청 플래그" 둘 다 만족할 때만 활성화 (오발 방지)
  const autofixRequested =
    request.nextUrl.searchParams.get('autofix') === '1' ||
    request.nextUrl.searchParams.get('autofix') === 'true';
  const autofixByEnv =
    process.env.BOOKING_ATTRIBUTION_AUTOFIX === '1' ||
    process.env.BOOKING_ATTRIBUTION_AUTOFIX === 'true';
  const autofix = autofixByEnv && autofixRequested;
  let backfilled = 0;
  const backfillErrors: string[] = [];

  if (autofix && flagged.length > 0) {
    const creativeIds = [
      ...new Set(flagged.map((r: Row) => r.content_creative_id).filter(Boolean)),
    ] as string[];
    const slugByCreative: Record<string, string> = {};
    if (creativeIds.length > 0) {
      const { data: creatives, error: ce } = await supabaseAdmin
        .from('content_creatives')
        .select('id, slug')
        .in('id', creativeIds);
      if (ce) {
        backfillErrors.push(ce.message);
      } else {
        for (const c of creatives || []) {
          const id = (c as { id: string }).id;
          const slug = (c as { slug: string | null }).slug;
          if (id && slug) slugByCreative[id] = slug;
        }
      }
    }

    const requestedLimit = Number(request.nextUrl.searchParams.get('max_fix') || '50');
    const MAX_FIX = Math.max(1, Math.min(200, Number.isFinite(requestedLimit) ? requestedLimit : 50));
    for (const r of flagged.slice(0, MAX_FIX)) {
      const patch: Record<string, string> = {};
      if (r.content_creative_id && slugByCreative[r.content_creative_id]) {
        patch.utm_source = 'blog';
        if (!r.utm_medium) patch.utm_medium = 'organic';
        if (!r.utm_campaign) patch.utm_campaign = slugByCreative[r.content_creative_id];
      } else if (r.affiliate_id) {
        patch.utm_source = 'affiliate';
        if (!r.utm_medium) patch.utm_medium = 'partner';
      } else if (r.referral_code) {
        patch.utm_source = 'referral';
        if (!r.utm_medium) patch.utm_medium = 'code';
      }
      if (Object.keys(patch).length === 0) continue;
      const { error: upErr } = await supabaseAdmin.from('bookings').update(patch).eq('id', r.id);
      if (upErr) backfillErrors.push(`${r.id}: ${upErr.message}`);
      else backfilled += 1;
    }
  }

  return {
    ok: true,
    window_since: since,
    utm_missing_with_signal: flagged.length,
    suspicious_no_medium: suspiciousNoMedium.length,
    sample_ids: suspiciousNoMedium.slice(0, 12).map((r: Row) => r.id),
    autofix_enabled: autofix,
    autofix_requested: autofixRequested,
    backfilled,
    backfill_errors: backfillErrors.length ? backfillErrors : undefined,
    errors: backfillErrors.length ? backfillErrors.slice(0, 5) : undefined,
  };
}

export const GET = withCronLogging('booking-attribution-audit', runAudit);
