import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';

export const dynamic = 'force-dynamic';

/**
 * 최근 예약 중 UTM 스냅샷이 비어 있는데 제휴/콘텐츠 귀속 신호만 있는 행을 점검한다.
 * (무결성 알림용 — 자동 수정은 하지 않음)
 */
async function runAudit(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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
    return { ok: false, error: error.message };
  }

  type Row = {
    id: string;
    affiliate_id: string | null;
    content_creative_id: string | null;
    referral_code: string | null;
    utm_medium: string | null;
  };

  const flagged = (rows || []).filter((r: Row) =>
    !!(r.affiliate_id || r.content_creative_id || r.referral_code),
  );
  const suspiciousNoMedium = flagged.filter((r: Row) => !r.utm_medium);

  return {
    ok: true,
    window_since: since,
    utm_missing_with_signal: flagged.length,
    suspicious_no_medium: suspiciousNoMedium.length,
    sample_ids: suspiciousNoMedium.slice(0, 12).map((r: Row) => r.id),
  };
}

export const GET = withCronLogging('booking-attribution-audit', runAudit);
