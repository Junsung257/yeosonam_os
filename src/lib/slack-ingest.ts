/**
 * 여소남 OS — Slack 입출금 원문 인제스트 공통 모듈
 *
 * Outbox 패턴:
 *   1. 원문을 먼저 slack_raw_events에 저장 (파싱 전)
 *   2. 파싱 → 성공 시 bank_transactions 생성
 *   3. 실패 시 parse_status='failed' 로 남겨 재처리 대기
 *
 * 이 모듈은 webhook과 gap-fill 크론이 공유합니다.
 *
 * 입력 경로:
 *   - webhook  → ingestSlackRawEvent({ source: 'webhook',  eventId, rawPayload, extractedText })
 *   - gap-fill → ingestSlackRawEvent({ source: 'gap_fill', channelId, messageTs, rawPayload, extractedText })
 *   - replay   → parseRawEvent(rawEventId)
 */

import { createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import {
  matchPaymentToBookings,
  applyDuplicateNameGuard,
  classifyMatch,
  isRefundTransaction,
  isFeeTransaction,
  BookingCandidate,
} from '@/lib/payment-matcher';
import { parseClobeMessage, ClobeTransaction } from '@/lib/clobe-parser';
import { normalizeName } from '@/lib/customer-name';

export const MAX_PARSE_ATTEMPTS = 5;

type Source = 'webhook' | 'gap_fill' | 'manual_replay';

interface IngestInput {
  source: Source;
  eventId?: string | null;
  channelId?: string | null;
  messageTs?: string | null;
  rawPayload: Record<string, unknown>;
  extractedText: string;
  slackMessageAt?: string | null;
}

interface IngestResult {
  rawEventId: string | null;
  duplicated: boolean;
  parsedCount: number;
  parseStatus: 'pending' | 'parsed' | 'failed' | 'dead' | 'ignored';
  errors: string[];
}

// ─── [1] 원문 저장 → 즉시 파싱 시도 (webhook 핫패스) ──────────────────────────

export async function ingestSlackRawEvent(input: IngestInput): Promise<IngestResult> {
  const { source, eventId, channelId, messageTs, rawPayload, extractedText, slackMessageAt } = input;

  // ── 입금/출금 키워드 없으면 ignored 처리 (저장은 함 — 나중에 전수 리플레이 가능)
  const hasKeyword = extractedText.includes('입금') || extractedText.includes('출금');

  // ── [1-1] Outbox 저장 (UPSERT — 중복 evt는 같은 row로 매핑)
  const insertPayload: Record<string, unknown> = {
    event_id: eventId ?? null,
    channel_id: channelId ?? null,
    message_ts: messageTs ?? null,
    raw_payload: rawPayload,
    extracted_text: extractedText,
    source,
    parse_status: hasKeyword ? 'pending' : 'ignored',
    slack_message_at: slackMessageAt ?? null,
  };

  // Supabase upsert: event_id 우선, 없으면 (channel_id, message_ts) 복합 키
  // onConflict를 두 번 지정할 수 없으므로 경로를 분기
  const onConflictKey = eventId ? 'event_id' : 'channel_id,message_ts';

  const { data: upserted, error: upsertErr } = await supabaseAdmin
    .from('slack_raw_events')
    .upsert([insertPayload], {
      onConflict: onConflictKey,
      ignoreDuplicates: false, // 이미 있으면 다른 필드 업데이트 (extracted_text 재계산 등)
    })
    .select('id, parse_status')
    .maybeSingle();

  if (upsertErr) {
    console.error('[slack-ingest] Outbox 저장 실패:', upsertErr.message);
    return { rawEventId: null, duplicated: false, parsedCount: 0, parseStatus: 'failed', errors: [upsertErr.message] };
  }

  const rawEventId = (upserted as any)?.id ?? null;
  const existingStatus = (upserted as any)?.parse_status as string | undefined;

  // 이미 parsed 상태면 중복 — 스킵
  if (existingStatus === 'parsed') {
    return { rawEventId, duplicated: true, parsedCount: 0, parseStatus: 'parsed', errors: [] };
  }
  if (existingStatus === 'ignored') {
    return { rawEventId, duplicated: true, parsedCount: 0, parseStatus: 'ignored', errors: [] };
  }
  if (!hasKeyword) {
    return { rawEventId, duplicated: false, parsedCount: 0, parseStatus: 'ignored', errors: [] };
  }

  // ── [1-2] 파싱 시도
  if (!rawEventId) {
    return { rawEventId: null, duplicated: false, parsedCount: 0, parseStatus: 'failed', errors: ['rawEventId 누락'] };
  }
  return parseRawEvent(rawEventId, source);
}

// ─── [2] 원문 → 파싱 → bank_transactions 생성 ────────────────────────────────

export async function parseRawEvent(rawEventId: string, source: Source = 'manual_replay'): Promise<IngestResult> {
  // 원문 로드
  const { data: rawRow, error: loadErr } = await supabaseAdmin
    .from('slack_raw_events')
    .select('id, extracted_text, parse_attempts, parse_status, channel_id, message_ts, event_id')
    .eq('id', rawEventId)
    .maybeSingle();

  if (loadErr || !rawRow) {
    return { rawEventId, duplicated: false, parsedCount: 0, parseStatus: 'failed', errors: [loadErr?.message ?? 'rawEvent 조회 실패'] };
  }

  const row = rawRow as {
    id: string;
    extracted_text: string;
    parse_attempts: number;
    parse_status: string;
    channel_id: string | null;
    message_ts: string | null;
    event_id: string | null;
  };

  if (row.parse_status === 'parsed') {
    return { rawEventId, duplicated: true, parsedCount: 0, parseStatus: 'parsed', errors: [] };
  }

  const attempts = (row.parse_attempts || 0) + 1;
  const errors: string[] = [];

  let transactions: ClobeTransaction[] = [];
  try {
    transactions = parseClobeMessage(row.extracted_text);
  } catch (e: any) {
    errors.push(`parseClobeMessage 예외: ${e?.message ?? String(e)}`);
  }

  // 0건 파싱 → 실패 / 영원히 죽이지 않음 (retry 후 dead)
  if (transactions.length === 0) {
    const nextStatus = attempts >= MAX_PARSE_ATTEMPTS ? 'dead' : 'failed';
    await supabaseAdmin
      .from('slack_raw_events')
      .update({
        parse_status: nextStatus,
        parse_attempts: attempts,
        last_parse_error: errors[0] || '파싱 결과 0건',
        parsed_at: new Date().toISOString(),
      })
      .eq('id', rawEventId);
    return { rawEventId, duplicated: false, parsedCount: 0, parseStatus: 'failed', errors };
  }

  // 활성 예약 로드 (매칭 후보)
  const { data: bookingsRaw } = await supabaseAdmin
    .from('bookings')
    .select(`
      id, booking_no, package_title,
      total_price, total_cost, paid_amount, total_paid_out,
      departure_date, status, payment_status, actual_payer_name,
      lead_customer_id,
      customers!lead_customer_id(name)
    `)
    .in('status', ['pending', 'confirmed']);

  const bookings: BookingCandidate[] = (bookingsRaw || []).map((b: any) => ({
    id: b.id,
    booking_no: b.booking_no,
    package_title: b.package_title,
    total_price: b.total_price,
    total_cost: b.total_cost,
    paid_amount: b.paid_amount || 0,
    total_paid_out: b.total_paid_out || 0,
    status: b.status,
    payment_status: b.payment_status,
    actual_payer_name: b.actual_payer_name,
    customer_name: b.customers?.name,
  }));

  // Alias 학습 맵 로드 (정규화된 alias → customer_id)
  const aliasMap = await loadAliasMap();

  let insertedCount = 0;
  const txSource: 'slack_webhook' | 'slack_gap_fill' | 'dlq_replay' =
    source === 'webhook' ? 'slack_webhook' :
    source === 'gap_fill' ? 'slack_gap_fill' :
    'dlq_replay';

  // ── Slack 원천 식별자 선정 (Stripe 원칙) ─────────────────────────────────
  // 우선순위: channel+message_ts (gap-fill과 webhook이 같은 값을 가짐) → event_id → raw row id
  const slackIdentity =
    row.channel_id && row.message_ts
      ? `ts:${row.channel_id}:${row.message_ts}`
      : row.event_id
      ? `evt:${row.event_id}`
      : `row:${row.id}`;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    try {
      const inserted = await insertOneTransaction({
        tx, txIndex: i, slackIdentity, bookings, aliasMap, rawEventId, rawText: row.extracted_text, txSource,
      });
      if (inserted) insertedCount++;
    } catch (e: any) {
      errors.push(`tx[${i}] 예외: ${e?.message ?? String(e)}`);
      console.error('[slack-ingest] 개별 tx 처리 실패:', e);
    }
  }

  // 원문 상태 최종 업데이트
  const finalStatus: 'parsed' | 'failed' | 'dead' =
    insertedCount > 0 ? 'parsed' :
    attempts >= MAX_PARSE_ATTEMPTS ? 'dead' : 'failed';

  await supabaseAdmin
    .from('slack_raw_events')
    .update({
      parse_status: finalStatus,
      parse_attempts: attempts,
      parsed_tx_count: insertedCount,
      last_parse_error: errors[0] || null,
      parsed_at: new Date().toISOString(),
    })
    .eq('id', rawEventId);

  return {
    rawEventId,
    duplicated: false,
    parsedCount: insertedCount,
    parseStatus: finalStatus,
    errors,
  };
}

// ─── [3] 단건 bank_transaction 생성 + 매칭 + 예약 반영 ───────────────────────

async function insertOneTransaction(args: {
  tx: ClobeTransaction;
  txIndex: number;                    // 같은 메시지 내 여러 트랜잭션 구분용
  slackIdentity: string;              // Slack 원천 식별자 (ts:channel:message_ts 등)
  bookings: BookingCandidate[];
  aliasMap: Map<string, { customerId: string; boost: number }>;
  rawEventId: string;
  rawText: string;
  txSource: 'slack_webhook' | 'slack_gap_fill' | 'dlq_replay';
}): Promise<boolean> {
  const { tx, txIndex, slackIdentity, bookings, aliasMap, rawEventId, rawText, txSource } = args;

  // Stripe 원칙: 원천(source-of-truth) 식별자 기반 멱등키
  // 같은 날짜·같은 이름·같은 금액의 2건 송금이 서로 다른 Slack 메시지이면
  // slackIdentity가 다르므로 정상적으로 2건 모두 저장됨
  const txEventId = createHash('sha256')
    .update(`${slackIdentity}#${txIndex}`)
    .digest('hex');

  const isRefund = tx.type === '출금' && isRefundTransaction(tx.memo + ' ' + tx.name);

  // ── Alias boost 적용된 매칭
  const aliasHit = aliasMap.get(normalizeName(tx.name));

  let bestMatch: ReturnType<typeof matchPaymentToBookings>[0] | null = null;
  let matchClass: 'auto' | 'review' | 'unmatched' = 'unmatched';
  let isFee = false;
  let feeAmount = 0;

  if (tx.type === '입금') {
    const candidates = matchPaymentToBookings({
      amount: tx.amount,
      senderName: tx.name,
      bookings,
    });
    // Alias 부스트: 매칭 결과 중 alias가 가리키는 고객의 예약이 있으면 신뢰도 가산
    if (aliasHit) {
      for (const c of candidates) {
        const bk = c.booking as any;
        if (bk.lead_customer_id === aliasHit.customerId) {
          c.confidence = Math.min(1.0, c.confidence + aliasHit.boost);
          c.reasons.push(`Alias 매핑 적용 (+${aliasHit.boost})`);
        }
      }
      candidates.sort((a, b) => b.confidence - a.confidence);
    }
    const guarded = applyDuplicateNameGuard(candidates);
    bestMatch = guarded[0] ?? null;
    matchClass = bestMatch ? classifyMatch(bestMatch.confidence) : 'unmatched';
  } else if (tx.type === '출금' && !isRefund) {
    const costMatched = bookings.filter(b => {
      const cost = b.total_cost || 0;
      return cost > 0 && Math.abs(tx.amount - cost) <= 5_000;
    });
    if (costMatched.length === 1) {
      bestMatch = {
        booking: costMatched[0],
        confidence: 0.65,
        reasons: ['원가 금액 일치'],
        matchType: 'amount_only',
      };
      matchClass = 'review';
      const feeResult = isFeeTransaction({
        withdrawalAmount: tx.amount,
        expectedCost: costMatched[0].total_cost || 0,
      });
      isFee = feeResult.isFee;
      feeAmount = feeResult.feeAmount;
    }
  }

  // Upsert (멱등)
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('bank_transactions')
    .upsert(
      [{
        slack_event_id: txEventId,
        raw_message: rawText,
        raw_event_id: rawEventId,
        source: txSource,
        transaction_type: tx.type,
        amount: tx.amount,
        counterparty_name: tx.name,
        memo: tx.memo,
        received_at: tx.transactionDate,
        booking_id: matchClass === 'auto' ? (bestMatch?.booking.id ?? null) : null,
        is_refund: isRefund,
        is_fee: isFee,
        fee_amount: feeAmount,
        match_status: matchClass,
        match_confidence: bestMatch?.confidence ?? 0,
        matched_by: matchClass === 'auto' ? 'auto' : null,
        matched_at: matchClass === 'auto' ? new Date().toISOString() : null,
        status: 'active',
      }],
      { onConflict: 'slack_event_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();

  if (insertError) {
    if (insertError.code === 'PGRST116') return false; // 중복 — 정상
    console.error('[slack-ingest] Upsert 실패:', insertError.message);
    throw insertError;
  }

  if (!inserted?.id) {
    return false; // 중복 스킵
  }

  // auto 매칭 시 예약 반영 (RPC 원자적 증감 + ledger 이중쓰기)
  if (matchClass === 'auto' && bestMatch) {
    await applyLedger({
      bookingId: bestMatch.booking.id,
      transactionType: tx.type,
      amount: tx.amount,
      isRefund,
      source: 'slack_ingest',
      sourceRefId: inserted.id,                              // bank_transactions.id
      idempotencyKey: `slack:auto:${inserted.id}`,           // 동일 tx 재처리 시 ledger 중복 방지
      memo: `slack auto-match ${tx.type} (${bestMatch.confidence.toFixed(2)})`,
    });

    await supabaseAdmin
      .from('bank_transactions')
      .update({ booking_id: bestMatch.booking.id })
      .eq('id', inserted.id);

    // ⚠️ auto_match alias 학습 비활성화
    // 이유: 부모-자식 대리입금 등 예외 케이스가 영구 노이즈로 고착화됨.
    // 오직 사장님이 수동 검토 후 연결한 건(manual_match)만 학습 대상.
    // bank-transactions PATCH match 경로에서 learnAlias() 호출.

    // 관리자 push 알림 (auto는 조용히, review/unmatched만 알림)
  } else if (tx.type === '입금' && (matchClass === 'review' || matchClass === 'unmatched')) {
    try {
      const { dispatchPushAsync } = await import('@/lib/push-dispatcher');
      dispatchPushAsync({
        title: matchClass === 'review' ? '입금 검토 필요' : '입금 매칭 확인',
        body: `${tx.amount.toLocaleString()}원 · ${tx.name}`,
        deepLink: `/m/admin/payments/${inserted.id}`,
        kind: matchClass === 'review' ? 'payment_review' : 'payment_unmatched',
        tag: `tx-${inserted.id}`,
      });
    } catch {
      /* push 실패는 무시 */
    }
  }

  return true;
}

// ─── [4] 예약 원장 Atomic 갱신 — update_booking_ledger RPC 래퍼 ─────────────
//
// 왜 RPC인가:
//   기존 SELECT → JS덧셈 → UPDATE 패턴은 동시 실행 시 lost update 발생.
//   RPC는 Postgres UPDATE 한 문장에서 row-lock + paid_amount = paid_amount + x
//   를 원자적으로 수행하므로 race-free.
//
// 입금:  paid_delta = +amount
// 환불:  paid_delta = -amount  (입금액 차감)
// 출금:  payout_delta = +amount (랜드사 송금 누적)

export async function applyLedger(params: {
  bookingId: string;
  transactionType: '입금' | '출금';
  amount: number;
  isRefund: boolean;
  rollback?: boolean;               // true면 부호 반전 (매칭 취소 등)
  // Phase 2a — append-only ledger 이중쓰기 인자 (선택)
  source?: string;                  // 'slack_ingest' | 'bank_tx_manual_match' 등
  sourceRefId?: string | null;      // bank_transactions.id 등
  idempotencyKey?: string | null;   // 재시도 안전성 보장. RPC 안에서 ':paid' / ':payout' 접미 분할
  memo?: string | null;
  createdBy?: string | null;
}): Promise<string | null> {
  const { bookingId, transactionType, amount, isRefund, rollback = false } = params;
  const sign = rollback ? -1 : 1;

  let paidDelta = 0;
  let payoutDelta = 0;

  if (transactionType === '입금' && !isRefund) {
    paidDelta = amount * sign;
  } else if (isRefund) {
    // 환불은 입금 차감
    paidDelta = -amount * sign;
  } else {
    // 일반 출금은 랜드사 송금 누적
    payoutDelta = amount * sign;
  }

  // rollback 시 idempotency_key 충돌 방지 — undo 는 별도 entry 로 기록
  const idem = params.idempotencyKey
    ? rollback ? `${params.idempotencyKey}:rollback` : params.idempotencyKey
    : null;

  const { data, error } = await supabaseAdmin.rpc('update_booking_ledger', {
    p_booking_id: bookingId,
    p_paid_delta: paidDelta,
    p_payout_delta: payoutDelta,
    p_source: params.source ?? 'slack_ingest',
    p_source_ref_id: params.sourceRefId ?? null,
    p_idempotency_key: idem,
    p_memo: params.memo ?? null,
    p_created_by: params.createdBy ?? null,
  });

  if (error) {
    console.error('[applyLedger] RPC 호출 실패:', error.message);
    throw error;
  }

  // RPC는 TABLE을 반환하므로 data는 배열
  const row = Array.isArray(data) ? data[0] : data;
  return (row as any)?.payment_status ?? null;
}

// ─── [5] Alias 학습/조회 ────────────────────────────────────────────────────

async function loadAliasMap(): Promise<Map<string, { customerId: string; boost: number }>> {
  const map = new Map<string, { customerId: string; boost: number }>();
  const { data } = await supabaseAdmin
    .from('customer_aliases')
    .select('customer_id, normalized_alias, confidence_boost');

  for (const row of (data || []) as any[]) {
    if (row.normalized_alias && row.customer_id) {
      map.set(row.normalized_alias, {
        customerId: row.customer_id,
        boost: row.confidence_boost ?? 0.3,
      });
    }
  }
  return map;
}

export async function learnAlias(params: {
  customerId: string;
  alias: string;
  source: 'manual_match' | 'auto_match' | 'admin_added';
  boost?: number;
}): Promise<void> {
  const normalized = normalizeName(params.alias);
  if (!normalized) return;

  // Upsert + usage_count 증가
  const { data: existing } = await supabaseAdmin
    .from('customer_aliases')
    .select('id, usage_count')
    .eq('customer_id', params.customerId)
    .eq('normalized_alias', normalized)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('customer_aliases')
      .update({
        usage_count: ((existing as any).usage_count || 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', (existing as any).id);
  } else {
    await supabaseAdmin
      .from('customer_aliases')
      .insert({
        customer_id: params.customerId,
        alias: params.alias,
        normalized_alias: normalized,
        source: params.source,
        confidence_boost: params.boost ?? 0.3,
      });
  }
}
