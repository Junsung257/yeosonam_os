/**
 * 알림톡 자동 발송 cron 엔드포인트
 *
 * 호출 방법 (cron-job.org 등 외부 크론):
 *   POST https://your-domain.com/api/notify/alimtalk?type=preparation
 *   POST https://your-domain.com/api/notify/alimtalk?type=passport
 *   Header: x-cron-secret: {CRON_SECRET}
 *
 * type=preparation → 출발 D-7 예약자에게 준비물 안내
 * type=passport    → 여권 만료 6개월 이내 고객에게 알림
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { sendPreparationGuide, sendPassportExpiryNotice } from '@/lib/kakao';

export async function POST(request: NextRequest) {
  // cron secret 검증
  const secret = request.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  // 준비물 안내 (출발 D-7)
  if (type === 'preparation') {
    const today = new Date();
    const d7 = new Date(today);
    d7.setDate(d7.getDate() + 7);
    const dateStr = d7.toISOString().split('T')[0];

    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('package_title, departure_date, customers!lead_customer_id(name, phone)')
      .eq('departure_date', dateStr)
      .in('status', ['pending', 'confirmed']);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const sent: string[] = [];
    const failed: string[] = [];

    for (const booking of bookings || []) {
      const customer = (booking as { customers?: { name?: string; phone?: string } }).customers;
      if (!customer?.phone || !customer?.name) continue;
      try {
        await sendPreparationGuide({
          phone: customer.phone,
          name: customer.name,
          packageTitle: (booking as { package_title?: string }).package_title || '여행 상품',
        });
        sent.push(customer.name);
      } catch {
        failed.push(customer.name);
      }
    }

    return NextResponse.json({ type: 'preparation', sent, failed, total: sent.length + failed.length });
  }

  // 여권 만료 알림 (6개월 이내)
  if (type === 'passport') {
    const today = new Date().toISOString().split('T')[0];
    const sixMonthsLater = new Date();
    sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
    const sixMonthsStr = sixMonthsLater.toISOString().split('T')[0];

    const { data: customers, error } = await supabase
      .from('customers')
      .select('name, phone, passport_expiry')
      .gte('passport_expiry', today)
      .lte('passport_expiry', sixMonthsStr)
      .not('phone', 'is', null);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const sent: string[] = [];
    const failed: string[] = [];

    for (const customer of customers || []) {
      if (!customer.phone || !customer.name) continue;
      try {
        await sendPassportExpiryNotice({
          phone: customer.phone,
          name: customer.name,
          expiryDate: customer.passport_expiry,
        });
        sent.push(customer.name);
      } catch {
        failed.push(customer.name);
      }
    }

    return NextResponse.json({ type: 'passport', sent, failed, total: sent.length + failed.length });
  }

  return NextResponse.json({ error: 'type 파라미터 필요 (preparation | passport)' }, { status: 400 });
}
