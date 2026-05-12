import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { isAdminRequest } from '@/lib/admin-guard';

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return NextResponse.json({ error: 'admin 권한 필요' }, { status: 403 });
  if (!isSupabaseConfigured) return NextResponse.json({ rows: [] });

  const sinceDays = Number(request.nextUrl.searchParams.get('days') || '90');
  const affiliateId = request.nextUrl.searchParams.get('affiliateId');
  const since = new Date(Date.now() - Math.max(1, sinceDays) * 24 * 60 * 60 * 1000).toISOString();

  let promoQuery = supabaseAdmin
    .from('affiliate_promo_codes')
    .select('id, affiliate_id, code, discount_type, discount_value, uses_count, is_active, max_uses')
    .order('uses_count', { ascending: false })
    .limit(500);
  if (affiliateId) promoQuery = promoQuery.eq('affiliate_id', affiliateId);
  const { data: promoRows, error } = await promoQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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

  const byCode = new Map<string, { bookings: number; revenue: number; commission: number }>();
  (bookings || []).forEach((b: any) => {
    const code = String(b.promo_code || '').trim();
    if (!code) return;
    const cur = byCode.get(code) || { bookings: 0, revenue: 0, commission: 0 };
    cur.bookings += 1;
    cur.revenue += Number(b.total_price) || 0;
    cur.commission += Number(b.influencer_commission) || 0;
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
      discount_type: p.discount_type,
      discount_value: p.discount_value,
      uses_count: p.uses_count,
      max_uses: p.max_uses,
      is_active: p.is_active,
      bookings: perf.bookings,
      revenue: perf.revenue,
      commission: perf.commission,
    };
  });

  return NextResponse.json({ rows });
}

