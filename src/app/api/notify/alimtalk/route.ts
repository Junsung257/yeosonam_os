/**
 * POST /api/notify/alimtalk
 *
 * Cron-only endpoint for sending preparation and passport-expiry Alimtalk notices.
 * Header: x-cron-secret: {CRON_SECRET}
 */

import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { sendPreparationGuide, sendPassportExpiryNotice } from '@/lib/kakao';
import { getSecret } from '@/lib/secret-registry';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { safeEqualString } from '@/lib/timing-safe';

type NotifyType = 'preparation' | 'passport';

function isNotifyType(value: string | null): value is NotifyType {
  return value === 'preparation' || value === 'passport';
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  const cronSecret = getSecret('CRON_SECRET');
  if (!cronSecret || !safeEqualString(secret, cronSecret)) {
    return apiResponse({ error: '인증에 실패했습니다.' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase가 설정되지 않았습니다.' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  if (!isNotifyType(type)) {
    return apiResponse({ error: 'type 파라미터는 preparation 또는 passport여야 합니다.' }, { status: 400 });
  }

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

    if (error) {
      console.error('[notify/alimtalk] preparation lookup failed:', sanitizeDbError(error));
      return apiResponse({ error: '발송 대상 조회에 실패했습니다.' }, { status: 500 });
    }

    let sent = 0;
    let failed = 0;

    for (const booking of bookings || []) {
      const customer = (booking as { customers?: { name?: string; phone?: string } }).customers;
      if (!customer?.phone || !customer?.name) continue;
      try {
        await sendPreparationGuide({
          phone: customer.phone,
          name: customer.name,
          packageTitle: (booking as { package_title?: string }).package_title || '여행 상품',
        });
        sent++;
      } catch (sendError) {
        failed++;
        console.warn('[notify/alimtalk] preparation send failed:', sanitizeDbError(sendError));
      }
    }

    return apiResponse({ type, sent, failed, total: sent + failed });
  }

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

  if (error) {
    console.error('[notify/alimtalk] passport lookup failed:', sanitizeDbError(error));
    return apiResponse({ error: '발송 대상 조회에 실패했습니다.' }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const customer of customers || []) {
    if (!customer.phone || !customer.name) continue;
    try {
      await sendPassportExpiryNotice({
        phone: customer.phone,
        name: customer.name,
        expiryDate: customer.passport_expiry,
      });
      sent++;
    } catch (sendError) {
      failed++;
      console.warn('[notify/alimtalk] passport send failed:', sanitizeDbError(sendError));
    }
  }

  return apiResponse({ type, sent, failed, total: sent + failed });
}
