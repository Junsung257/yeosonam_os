/**
 * 신한은행 SMS 수신 웹훅
 *
 * Android "SMS Forwarder" 앱에서 다음과 같이 설정:
 *   URL: https://your-domain.com/api/sms/receive
 *   Method: POST
 *   Header: x-webhook-secret: {SMS_WEBHOOK_SECRET}
 *   Body: { "message": "SMS 원문", "from": "발신번호", "receivedAt": "ISO날짜" }
 *
 * 처리 흐름:
 *   1. SMS 파싱 (신한은행 입금 메시지만 처리)
 *   2. 예약 매칭 알고리즘 실행
 *   3. sms_payments 테이블에 저장
 *   4. 신뢰도 90%↑ → 예약 자동 완료 처리
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secret-registry';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { parseShinhanSMS } from '@/lib/sms-parser';
import { matchPaymentToBookings, classifyMatch, BookingCandidate } from '@/lib/payment-matcher';

export async function POST(request: NextRequest) {
  // 웹훅 시크릿 검증
  const secret = request.headers.get('x-webhook-secret');
  const expected = getSecret('SMS_WEBHOOK_SECRET');
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: '인증 실패' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  let body: { message?: string; from?: string; receivedAt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 });
  }

  const rawSms = body.message || '';
  if (!rawSms) {
    return NextResponse.json({ error: 'message 필드 필요' }, { status: 400 });
  }

  // SMS 파싱
  const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
  const parsed = parseShinhanSMS(rawSms, receivedAt);

  if (!parsed.isDeposit || !parsed.amount) {
    // 입금 메시지가 아니면 저장하지 않고 OK 반환
    return NextResponse.json({ status: 'ignored', reason: '입금 메시지 아님' });
  }

  // 매칭 대상 예약 조회 (pending, confirmed 상태)
  const { data: bookingsRaw } = await supabase
    .from('bookings')
    .select('id, booking_no, package_title, total_price, status, customers!lead_customer_id(name)')
    .in('status', ['pending', 'confirmed']);

  const bookings: BookingCandidate[] = (bookingsRaw || []).map((b: {
    id: string;
    booking_no?: string;
    package_title?: string;
    total_price?: number;
    status: string;
    customers?: { name?: string } | null;
  }) => ({
    id: b.id,
    booking_no: b.booking_no,
    package_title: b.package_title,
    total_price: b.total_price,
    paid_amount: 0, // TODO: 기입금 tracking 추가 시 반영
    status: b.status,
    customer_name: b.customers?.name,
  }));

  // 매칭 실행
  const matches = matchPaymentToBookings({
    amount: parsed.amount,
    senderName: parsed.senderName,
    bookings,
  });

  const bestMatch = matches[0] || null;
  const confidence = bestMatch?.confidence || 0;
  const matchClass = bestMatch ? classifyMatch(confidence) : 'unmatched';

  // sms_payments 테이블에 저장
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
    console.error('[SMS 수신] 저장 실패:', paymentError);
    // 테이블 없어도 매칭 결과는 반환
  }

  // 자동 매칭 (신뢰도 90%↑) → Phase 2a update_booking_ledger RPC 로 atomic + ledger 이중쓰기
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
      console.error('[SMS 자동매칭] update_booking_ledger 실패:', rpcErr.message);
    } else {
      console.log(`[SMS 자동매칭] 예약 ${bestMatch.booking.booking_no?.slice(0, 4)}**** 연결 완료 (신뢰도 ${Math.round(confidence * 100)}%)`);
    }
  }

  return NextResponse.json({
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
