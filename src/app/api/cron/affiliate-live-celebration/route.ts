import { NextRequest } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { sendAffiliateBookingCelebration } from '@/lib/kakao';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';
import { successResponse, errorResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return successResponse({ ok: true, skipped: 'DB not configured' });
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  try {
    const { data: bookings, error } = await supabaseAdmin
      .from('bookings')
      .select('id, affiliate_id, package_title, total_price, influencer_commission, created_at')
      .not('affiliate_id', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return errorResponse('DB_ERROR', sanitizeDbError(error), 500);

    let notified = 0;
    for (const b of (bookings || []) as Array<{
      id: string;
      affiliate_id: string;
      package_title: string | null;
      total_price: number | null;
      influencer_commission: number | null;
    }>) {
      const { data: exists } = await supabaseAdmin
        .from('audit_logs')
        .select('id')
        .eq('action', 'AFFILIATE_LIVE_CELEBRATION_SENT')
        .eq('target_id', b.id)
        .maybeSingle();
      if (exists) continue;

      const { data: aff } = await supabaseAdmin
        .from('affiliates')
        .select('id, name, phone')
        .eq('id', b.affiliate_id)
        .maybeSingle();
      if (!aff) continue;

      const affiliate = aff as { id: string; name: string; phone: string | null };
      if (!affiliate.phone) continue;

      await sendAffiliateBookingCelebration({
        phone: affiliate.phone,
        affiliateName: affiliate.name,
        packageTitle: b.package_title || '여행 상품',
        totalPrice: Number(b.total_price) || 0,
        commission: Number(b.influencer_commission) || 0,
      }).catch((err: unknown) => {
        console.warn('[Live Celebration] Kakao notification failed:', sanitizeDbError(err));
      });

      await void(supabaseAdmin.from('audit_logs').insert({
        action: 'AFFILIATE_LIVE_CELEBRATION_SENT',
        target_type: 'booking',
        target_id: b.id,
        description: `affiliate=${affiliate.id}`,
      }));
      notified += 1;
    }

    await reportAffiliateCronSuccess('affiliate-live-celebration', { checked: (bookings || []).length, notified });
    return successResponse({ ok: true, checked: (bookings || []).length, notified });
  } catch (err) {
    await reportAffiliateCronFailure('affiliate-live-celebration', err, { since });
    return errorResponse(
      'CRON_FAILED',
      sanitizeDbError(err, 'affiliate live celebration failed'),
      500,
    );
  }
}
