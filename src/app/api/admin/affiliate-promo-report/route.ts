import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

async function getHandler(request: NextRequest) {
  if (!isSupabaseConfigured) return apiResponse({ rows: [] });

  const sinceDays = Number(request.nextUrl.searchParams.get('days') || '90');
  const affiliateId = request.nextUrl.searchParams.get('affiliateId');
  const since = new Date(Date.now() - Math.max(1, sinceDays) * 24 * 60 * 60 * 1000).toISOString();

  let promoQuery = supabaseAdmin
    .from('creator_codes')
    .select('id, affiliate_id, code, status, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (affiliateId) promoQuery = promoQuery.eq('affiliate_id', affiliateId);
  const { data: promoRows, error } = await promoQuery;
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });

  const affiliateIds = [...new Set((promoRows || []).map((p: any) => p.affiliate_id).filter(Boolean))];
  const { data: affiliates } = affiliateIds.length
    ? await supabaseAdmin.from('affiliates').select('id, name, referral_code').in('id', affiliateIds)
    : { data: [] };
  const affMap = new Map<string, { name: string; referral_code: string }>();
  (affiliates || []).forEach((a: any) => affMap.set(a.id, { name: a.name, referral_code: a.referral_code }));

  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, promo_code, total_price, influencer_commission, created_at')
    .gte('created_at', since)
    .not('promo_code', 'is', null)
    .limit(5000);

  const bookingIds = (bookings || []).map((booking: any) => booking.id).filter(Boolean);
  const { data: ledgerEntries } = bookingIds.length
    ? await supabaseAdmin
      .from('commission_ledger_entries')
      .select('booking_id, amount_krw')
      .in('booking_id', bookingIds)
    : { data: [] };
  const ledgerByBooking = new Map<string, number>();
  (ledgerEntries || []).forEach((entry: any) => {
    const bookingId = String(entry.booking_id || '');
    if (!bookingId) return;
    ledgerByBooking.set(bookingId, (ledgerByBooking.get(bookingId) || 0) + (Number(entry.amount_krw) || 0));
  });

  const byCode = new Map<string, { bookings: number; revenue: number; commission: number }>();
  (bookings || []).forEach((b: any) => {
    const code = String(b.promo_code || '').trim();
    if (!code) return;
    const cur = byCode.get(code) || { bookings: 0, revenue: 0, commission: 0 };
    cur.bookings += 1;
    cur.revenue += Number(b.total_price) || 0;
    cur.commission += ledgerByBooking.get(String(b.id)) || 0;
    byCode.set(code, cur);
  });

  const rows = (promoRows || []).map((p: any) => {
    const perf = byCode.get(String(p.code)) || { bookings: 0, revenue: 0, commission: 0 };
    const aff = affMap.get(p.affiliate_id);
    return {
      code: p.code,
      affiliate_id: p.affiliate_id,
      affiliate_name: aff?.name || '-',
      referral_code: aff?.referral_code || '-',
      code_type: 'CREATOR_ATTRIBUTION',
      discount_type: null,
      discount_value: null,
      uses_count: perf.bookings,
      max_uses: null,
      is_active: p.status === 'ACTIVE',
      bookings: perf.bookings,
      revenue: perf.revenue,
      commission: perf.commission,
    };
  });

  return apiResponse({ rows, contract_version: 'creator-code-report-v2' });
}

export const GET = withAdminGuard(getHandler);
