import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import crypto from 'crypto';

export const runtime = 'nodejs';

function verifyToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    const secret = process.env.AFFILIATE_TOKEN_SECRET || process.env.SUPABASE_JWT_SECRET || 'dev-secret-change-in-prod';
    const expectedHmac = crypto.createHmac('sha256', secret).update(parts[0]).digest('hex');
    if (parts[1] !== expectedHmac) return null;
    return payload.affiliate_id;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  const affiliateId = verifyToken(auth.slice(7));
  if (!affiliateId) {
    return NextResponse.json({ error: '유효하지 않은 토큰' }, { status: 401 });
  }

  // --- 1. 어필리에이트 기본 정보 ---
  const { data: affiliate } = await supabaseAdmin
    .from('affiliates')
    .select('id, name, referral_code, grade, bonus_rate, content_quota, content_used, branding_level, last_conversion_at, total_commission, booking_count')
    .eq('id', affiliateId)
    .single();

  if (!affiliate) {
    return NextResponse.json({ error: '계정 없음' }, { status: 404 });
  }

  // --- 2. 카드뉴스 성과 ---
  const { data: cardNews } = await supabaseAdmin
    .from('card_news')
    .select('id, title_slides, created_at, views, clicks, status')
    .eq('created_by_affiliate_id', affiliateId)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: perfData } = await supabaseAdmin
    .from('card_news')
    .select('views, clicks')
    .eq('created_by_affiliate_id', affiliateId);

  const totalViews: number = (perfData || []).reduce((sum: number, c: { views?: number }) => sum + (c.views || 0), 0);
  const totalClicks: number = (perfData || []).reduce((sum: number, c: { clicks?: number }) => sum + (c.clicks || 0), 0);

  // --- 3. 정산 내역 (최근 6개월) ---
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const { data: settlements } = await supabaseAdmin
    .from('settlements')
    .select('id, settlement_period, status, total_amount, final_payout, settled_at')
    .eq('affiliate_id', affiliateId)
    .gte('settlement_period', sixMonthsAgo.toISOString().slice(0, 7))
    .order('settlement_period', { ascending: false });

  // 총 누적 수익 계산
  const totalRevenue: number = (settlements || [])
    .filter((s: { status: string }) => s.status === 'COMPLETED')
    .reduce((sum: number, s: { final_payout?: number }) => sum + (s.final_payout || 0), 0);
  const pendingRevenue: number = (settlements || [])
    .filter((s: { status: string }) => s.status !== 'COMPLETED')
    .reduce((sum: number, s: { total_amount?: number }) => sum + (s.total_amount || 0), 0);

  // --- 4. 어필리에이터 콘텐츠 인사이트 (최근 5개) ---
  const { data: insights } = await supabaseAdmin
    .from('affiliate_content_insights')
    .select('id, insight_type, title, content, is_read, created_at')
    .eq('affiliate_id', affiliateId)
    .order('created_at', { ascending: false })
    .limit(5);

  // --- 5. 최근 7일 예약 추이 ---
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: recentNews } = await supabaseAdmin
    .from('card_news')
    .select('id, created_at')
    .eq('created_by_affiliate_id', affiliateId)
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: true });

  const dailyMap = new Map<string, { bookings: number; revenue: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, { bookings: 0, revenue: 0 });
  }
  (recentNews || []).forEach((cn: { created_at: string }) => {
    const key = cn.created_at.slice(0, 10);
    if (dailyMap.has(key)) {
      dailyMap.get(key)!.bookings += 1;
    }
  });

  return NextResponse.json({
    affiliate: {
      name: affiliate.name,
      referral_code: affiliate.referral_code,
      grade: affiliate.grade,
      bonus_rate: affiliate.bonus_rate,
      branding_level: affiliate.branding_level,
      content_quota: affiliate.content_quota,
      content_used: affiliate.content_used,
      total_commission: affiliate.total_commission || 0,
      booking_count: affiliate.booking_count || 0,
      last_conversion_at: affiliate.last_conversion_at,
    },
    total_views: totalViews,
    total_clicks: totalClicks,
    total_revenue: totalRevenue,
    pending_revenue: pendingRevenue,
    recent_card_news: cardNews || [],
    settlements: settlements || [],
    insights: insights || [],
    booking_trend: Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      bookings: data.bookings,
      revenue: data.revenue,
    })),
  });
}
