import { type NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { parseShinhanSMS } from '@/lib/sms-parser';
import {
  matchPaymentToBookings,
  applyDuplicateNameGuard,
  classifyMatch,
  BookingCandidate,
} from '@/lib/payment-matcher';
import { safeEqualString } from '@/lib/timing-safe';
import { buildBankTransactionFingerprint } from '@/lib/bank-transaction-fingerprint';

function buildSmsEventId(params: {
  from?: string;
  messageId?: string;
  rawSms: string;
  receivedAt: string;
}) {
  const stableInput = params.messageId
    ? `${params.from ?? ''}:${params.messageId}`
    : `${params.from ?? ''}:${params.receivedAt}:${params.rawSms}`;
  return `sms_${createHash('sha256').update(stableInput).digest('hex')}`;
}

async function findExistingBankTransactionByFingerprint(fingerprint: string) {
  const { data } = await supabaseAdmin
    .from('bank_transactions')
    .select('id, booking_id, match_status, source_metadata')
    .eq('transaction_fingerprint', fingerprint)
    .maybeSingle();

  return data as {
    id: string;
    booking_id: string | null;
    match_status: string | null;
    source_metadata?: Record<string, unknown> | null;
  } | null;
}

async function attachSmsWebhookEvidence(existingId: string, metadata: Record<string, unknown>) {
  const { data: existing } = await supabaseAdmin
    .from('bank_transactions')
    .select('source_metadata')
    .eq('id', existingId)
    .maybeSingle();
  const previousMetadata = ((existing as { source_metadata?: Record<string, unknown> } | null)?.source_metadata ?? {}) as Record<string, unknown>;

  await supabaseAdmin
    .from('bank_transactions')
    .update({
      source_metadata: {
        ...previousMetadata,
        sms_webhook: metadata,
      },
    } as Record<string, unknown>)
    .eq('id', existingId);
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-webhook-secret');
  const expected = getSecret('SMS_WEBHOOK_SECRET');
  if (!expected || !safeEqualString(secret, expected)) {
    return apiResponse({ error: '인증 실패' }, { status: 401 });
  }

  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 500 });
  }

  let body: { message?: string; from?: string; receivedAt?: string; messageId?: string };
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

  if (!parsed.transactionType || !parsed.amount) {
    return apiResponse({ status: 'ignored', reason: '입출금 메시지 아님' });
  }

  const { data: bookingsRaw } = await supabaseAdmin
    .from('bookings')
    .select(`
      id, booking_no, package_title,
      total_price, total_cost, paid_amount, total_paid_out,
      status, payment_status, actual_payer_name,
      customers!lead_customer_id(name)
    `)
    .in('status', ['pending', 'confirmed']);

  const bookings: BookingCandidate[] = (bookingsRaw || []).map((b: Record<string, unknown>) => ({
    id: b.id as string,
    booking_no: b.booking_no as string | undefined,
    package_title: b.package_title as string | undefined,
    total_price: b.total_price as number | undefined,
    total_cost: b.total_cost as number | undefined,
    paid_amount: (b.paid_amount as number) || 0,
    total_paid_out: (b.total_paid_out as number) || 0,
    status: b.status as string,
    payment_status: b.payment_status as string | undefined,
    actual_payer_name: b.actual_payer_name as string | null | undefined,
    customer_name: ((b.customers as { name?: string } | null)?.name) ?? undefined,
  }));

  const matches = parsed.transactionType === '입금'
    ? applyDuplicateNameGuard(matchPaymentToBookings({
        amount: parsed.amount,
        senderName: parsed.senderName,
        bookings,
      }))
    : [];

  const bestMatch = matches[0] || null;
  const confidence = bestMatch?.confidence || 0;
  const matchClass = bestMatch ? classifyMatch(confidence) : 'unmatched';
  const bankTxMatchStatus = parsed.transactionType === '입금' ? matchClass : 'unmatched';
  const smsEventId = buildSmsEventId({
    from: body.from,
    messageId: body.messageId,
    rawSms,
    receivedAt: parsed.receivedAt.toISOString(),
  });
  const transactionFingerprint = buildBankTransactionFingerprint({
    receivedAt: parsed.receivedAt.toISOString(),
    txType: parsed.transactionType,
    amount: parsed.amount,
    counterpartyName: parsed.senderName,
  });

  const bankTxPayload = {
    slack_event_id: smsEventId,
    raw_message: rawSms,
    transaction_fingerprint: transactionFingerprint,
    source: 'sms_webhook',
    source_metadata: {
      sms_webhook: {
        from: body.from ?? null,
        message_id: body.messageId ?? null,
        received_at: parsed.receivedAt.toISOString(),
      },
    },
    transaction_type: parsed.transactionType,
    amount: parsed.amount,
    counterparty_name: parsed.senderName,
    memo: body.from ? `SMS ${body.from}` : 'SMS',
    received_at: parsed.receivedAt.toISOString(),
    booking_id: bankTxMatchStatus === 'auto' ? (bestMatch?.booking.id ?? null) : null,
    is_refund: false,
    is_fee: false,
    fee_amount: 0,
    match_status: bankTxMatchStatus,
    match_confidence: confidence,
    matched_by: bankTxMatchStatus === 'auto' ? 'auto' : null,
    matched_at: bankTxMatchStatus === 'auto' ? new Date().toISOString() : null,
    status: 'active',
  };

  const existingBankTx = await findExistingBankTransactionByFingerprint(transactionFingerprint);
  if (existingBankTx?.id) {
    const smsMetadata = {
      from: body.from ?? null,
      message_id: body.messageId ?? null,
      received_at: parsed.receivedAt.toISOString(),
      event_id: smsEventId,
    };

    await attachSmsWebhookEvidence(existingBankTx.id, smsMetadata);

    if (
      parsed.transactionType === '입금' &&
      bankTxMatchStatus === 'auto' &&
      bestMatch &&
      !existingBankTx.booking_id
    ) {
      const matchedAt = new Date().toISOString();
      const { error: updateErr } = await supabaseAdmin
        .from('bank_transactions')
        .update({
          booking_id: bestMatch.booking.id,
          match_status: 'auto',
          match_confidence: confidence,
          matched_by: 'auto',
          matched_at: matchedAt,
        } as Record<string, unknown>)
        .eq('id', existingBankTx.id);

      if (updateErr) {
        console.error('[SMS receive] existing bank tx match update failed:', sanitizeDbError(updateErr));
      } else {
        const { error: rpcErr } = await supabaseAdmin.rpc('update_booking_ledger', {
          p_booking_id: bestMatch.booking.id,
          p_paid_delta: parsed.amount,
          p_payout_delta: 0,
          p_source: 'sms_payment',
          p_source_ref_id: existingBankTx.id,
          p_idempotency_key: `sms:merge:auto:${existingBankTx.id}`,
          p_memo: `SMS merged auto-match ${parsed.senderName} (${Math.round(confidence * 100)}%)`,
          p_created_by: 'sms',
        });
        if (rpcErr) {
          console.error('[SMS merged auto-match] update_booking_ledger failed:', sanitizeDbError(rpcErr));
        }
      }
    }

    return apiResponse({
      status: 'merged_existing',
      parsed: {
        transactionType: parsed.transactionType,
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
      bankTransactionId: existingBankTx.id,
    });
  }

  let { data: bankTx, error: bankTxError } = await supabaseAdmin
    .from('bank_transactions')
    .upsert([bankTxPayload as Record<string, unknown>], { onConflict: 'slack_event_id', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();

  if (bankTxError?.code === '23514') {
    const fallback = await supabaseAdmin
      .from('bank_transactions')
      .upsert([{
        ...bankTxPayload,
        source: 'manual',
        memo: `${bankTxPayload.memo} direct-sms`,
      } as Record<string, unknown>], { onConflict: 'slack_event_id', ignoreDuplicates: true })
      .select('id')
      .maybeSingle();
    bankTx = fallback.data;
    bankTxError = fallback.error;
  }

  if (bankTxError) {
    console.error('[SMS receive] bank tx save failed:', sanitizeDbError(bankTxError));
    return apiResponse({ error: sanitizeDbError(bankTxError, '송금내역 저장 실패') }, { status: 500 });
  }

  const insertedBankTxId = (bankTx as { id?: string } | null)?.id ?? null;

  if (insertedBankTxId && parsed.transactionType === '입금') {
    const { error: paymentError } = await supabaseAdmin
      .from('sms_payments')
      .insert([{
        raw_sms: rawSms,
        sender_name: parsed.senderName,
        amount: parsed.amount,
        received_at: parsed.receivedAt.toISOString(),
        booking_id: bestMatch?.booking.id || null,
        match_confidence: confidence,
        status: matchClass === 'auto' ? 'matched' : matchClass === 'review' ? 'review' : 'unmatched',
      }]);

    if (paymentError) {
      console.error('[SMS receive] sms_payments save failed:', sanitizeDbError(paymentError));
    }
  }

  if (insertedBankTxId && bankTxMatchStatus === 'auto' && bestMatch && parsed.amount) {
    const { error: rpcErr } = await supabaseAdmin.rpc('update_booking_ledger', {
      p_booking_id: bestMatch.booking.id,
      p_paid_delta: parsed.amount,
      p_payout_delta: 0,
      p_source: 'sms_payment',
      p_source_ref_id: insertedBankTxId,
      p_idempotency_key: `sms:auto:${insertedBankTxId}`,
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
    status: insertedBankTxId ? 'processed' : 'duplicate',
    parsed: {
      transactionType: parsed.transactionType,
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
    bankTransactionId: insertedBankTxId,
  });
}
