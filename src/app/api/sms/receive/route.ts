import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { parseShinhanSMS } from '@/lib/sms-parser';
import { matchPaymentToBookings, classifyMatch, BookingCandidate } from '@/lib/payment-matcher';
import { safeEqualString } from '@/lib/timing-safe';

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-webhook-secret');
  const expected = getSecret('SMS_WEBHOOK_SECRET');
  if (!expected || !safeEqualString(secret, expected)) {
    return apiResponse({ error: '인증 실패' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 500 });
  }

  let body: { message?: string; from?: string; receivedAt?: string };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: '잘못된 요청 형식' }, { status: 400 });
  }

  const rawSms = body.message || '';
  if (!rawSms) {
    return apiResponse({ error: 'message 필드 필요' }, { status: 400 });
  }

  const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
  const parsed = parseShinhanSMS(rawSms, receivedAt);

  if (!parsed.isDeposit || !parsed.amount) {
    return apiResponse({ status: 'ignored', reason: '입금 메시지 아님' });
  }

  const { data: bookingsRaw } = await supabase
    .from('bookings')
    .select('id, booking_no, package_title, total_price, status, customers!lead_customer_id(name)')
    .in('status', ['pending', 'confirmed']);

  const bookings: BookingCandidate[] = (bookingsRaw || []).map((b: Record<string, unknown>) => ({
    id: b.id as string,
    booking_no: b.booking_no as string | undefined,
    package_title: b.package_title as string | undefined,
    total_price: b.total_price as number | undefined,
    paid_amount: 0,
    status: b.status as string,
    customer_name: ((b.customers as { name?: string } | null)?.name) ?? undefined,
  }));

  const matches = matchPaymentToBookings({
    amount: parsed.amount,
    senderName: parsed.senderName,
    bookings,
  });

  const bestMatch = matches[0] || null;
  const confidence = bestMatch?.confidence || 0;
  const matchClass = bestMatch ? classifyMatch(confidence) : 'unmatched';

  const { data: payment, error: paymentError } = await supabase
    .from('sms_payments')
    .insert([{
      raw_sms: rawSms,
      sender_name: parsed.senderName,
      amount: parsed.amount,
      received_at: parsed.receivedAt.toISOString(),
      booking_id: bestMatch?.booking.id || null,
      match_confidence: confidence,
      status: matchClass === 'auto' ? 'matched' : matchClass === 'review' ? 'review' : 'unmatched',
    }])
    .select()
    .single();

  if (paymentError) {
    console.error('[SMS receive] save failed:', sanitizeDbError(paymentError));
  }

  if (matchClass === 'auto' && bestMatch && parsed.amount) {
    const idem = payment?.id ? `sms:${payment.id}` : `sms:${bestMatch.booking.id}:${parsed.receivedAt.toISOString()}`;
    const { error: rpcErr } = await supabase.rpc('update_booking_ledger', {
      p_booking_id: bestMatch.booking.id,
      p_paid_delta: parsed.amount,
      p_payout_delta: 0,
      p_source: 'sms_payment',
      p_source_ref_id: payment?.id ?? null,
      p_idempotency_key: idem,
      p_memo: `SMS auto-match ${parsed.senderName} (${Math.round(confidence * 100)}%)`,
      p_created_by: 'sms',
    });
    if (rpcErr) {
      console.error('[SMS auto-match] update_booking_ledger failed:', sanitizeDbError(rpcErr));
    } else {
      console.log(`[SMS auto-match] booking ${bestMatch.booking.booking_no?.slice(0, 4)}**** linked (${Math.round(confidence * 100)}%)`);
    }
  }

  return apiResponse({
    status: 'processed',
    parsed: {
      senderName: parsed.senderName,
      amount: parsed.amount,
      receivedAt: parsed.receivedAt,
    },
    match: bestMatch ? {
      bookingId: bestMatch.booking.id,
      bookingNo: bestMatch.booking.booking_no,
      confidence: Math.round(confidence * 100),
      classification: matchClass,
      reasons: bestMatch.reasons,
    } : null,
    paymentId: payment?.id,
  });
}
