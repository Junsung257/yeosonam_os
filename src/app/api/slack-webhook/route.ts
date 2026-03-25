/**
 * 여소남 OS — 슬랙 입출금 웹훅 v4  (Vercel Serverless 강제 종료 방어)
 *
 * ── v4 변경 ──────────────────────────────────────────────────────────────────
 * [v4] 동기식 완전 실행 (Early Return 제거)
 *       기존 v2-3의 fire-and-forget 패턴은 Vercel Serverless에서 치명적이다.
 *       응답 반환 즉시 런타임이 프로세스를 강제 종료(Freeze)하므로
 *       백그라운드 Promise가 중간에 kill 되어 DB Insert가 실행되지 않는다.
 *
 *       수정: POST 핸들러가 processWebhookEvent()를 끝까지 await 한 뒤
 *       최종 응답을 반환한다. Promise.all 병렬 처리로 속도를 보상하므로
 *       Slack 3초 타임아웃 문제는 Retry ACK 로직(X-Slack-Retry-Num)이 흡수한다.
 *       (첫 요청이 늦어도 Slack Retry #1 은 즉시 ACK 반환 — 중복 처리 없음)
 *
 * ── v3 유지 ──────────────────────────────────────────────────────────────────
 * [v3-1] deepExtractText : 재귀 딥 텍스트 추출기
 *          blocks / elements / attachments / fields 를 어떤 깊이든 파고들어
 *          모든 text / pretext / fallback / value 속성을 수집한다.
 *          depth 제한(12) + WeakSet 순환참조 가드 포함.
 *
 * [v3-2] Slack 엔티티 언이스케이핑 (파서 전달 전 명시적 처리)
 *          &amp; → &  (반드시 첫 번째)
 *          &lt;  → <
 *          &gt;  → >
 *          이 처리를 안 하면 > 기반 blockquote 정규식이 절대 작동하지 않는다.
 *
 * [v3-3] Promise.all 병렬 Upsert
 *          N건 트랜잭션을 순차 for-await 대신 Promise.all 로 동시 처리.
 *
 * ── v2 유지 ──────────────────────────────────────────────────────────────────
 * [v2-1] bot_message subtype 완전 허용
 *          message 타입이면 subtype 무관 통과 (Clobe AI = bot_message 서브타입)
 *
 * [v2-2] Dead Letter Queue → message_logs 테이블 사용
 *          bank_transactions.amount_check 제약(amount > 0) 충돌 방지.
 *          파싱 전 message_logs(content, payload, status='pending') 先 Insert.
 *          파싱 0건 → status='error', 성공 → status='processed' 로 업데이트.
 *
 * [v2-4] 복합 PK  baseEventId + "_" + index
 *          멀티 트랜잭션 충돌 방지 + 멱등성 보장.
 *
 * ── 처리 흐름 ────────────────────────────────────────────────────────────────
 *  1.  url_verification → challenge 즉시 반환
 *  2.  HMAC-SHA256 서명 검증
 *  3.  X-Slack-Retry-Num > 0 → 즉시 ACK (중복 방지)
 *  4.  await processWebhookEvent() — 완전 실행 보장
 *  5.  deepExtractText → Slack 엔티티 언이스케이핑 → fullText 완성
 *  6.  DLQ Insert  (match_status = 'error', amount = 0)
 *  7.  parseClobeMessage(fullText) → ClobeTransaction[]
 *  8.  Promise.all → 복합키 upsert + auto 매칭 시 예약 정산 반영
 *  9.  DLQ 레코드 삭제 (파싱 성공 시)
 * 10.  200 OK 반환
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, createHash }    from 'crypto';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  matchPaymentToBookings,
  applyDuplicateNameGuard,
  classifyMatch,
  calcPaymentStatus,
  isRefundTransaction,
  isFeeTransaction,
  BookingCandidate,
} from '@/lib/payment-matcher';
import { parseClobeMessage } from '@/lib/clobe-parser';

// ─── [1] Slack HMAC-SHA256 서명 검증 ─────────────────────────────────────────

async function verifySlackSignature(req: NextRequest, body: string): Promise<boolean> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return true; // 개발 환경: 서명 없으면 통과

  const timestamp = req.headers.get('x-slack-request-timestamp');
  const slackSig  = req.headers.get('x-slack-signature');
  if (!timestamp || !slackSig) return false;

  // 재전송 공격 방지: 5분 이내 요청만 허용
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const hmac = createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex');

  return `v0=${hmac}` === slackSig;
}

// ─── [2] 재귀 딥 텍스트 추출기 ───────────────────────────────────────────────

/**
 * Slack 페이로드 노드에서 텍스트를 재귀적으로 수집한다.
 *
 * 커버 범위:
 *   - event.text (최상위 문자열)
 *   - blocks[].text / blocks[].text.text (section · header · input)
 *   - blocks[].elements[].elements[].text  (rich_text 계층)
 *   - attachments[].text / .pretext / .fallback / .fields[].value
 *   - 어떤 중첩 수준도 depth ≤ 12 까지 탐색
 *
 * @param node  - 현재 탐색 노드 (임의 타입)
 * @param bag   - 누적 텍스트 버킷 (내부 재귀용)
 * @param seen  - 순환 참조 가드 WeakSet
 * @param depth - 재귀 깊이 제한 카운터
 */
function deepExtractText(
  node:  unknown,
  bag:   string[]        = [],
  seen:  WeakSet<object> = new WeakSet(),
  depth: number          = 0,
): string[] {
  // ── 깊이 / null 가드 ──────────────────────────────────────────────────────
  if (depth > 12 || node === null || node === undefined) return bag;

  // ── 문자열 리프: 공백 제거 후 수집 ──────────────────────────────────────
  if (typeof node === 'string') {
    const s = node.trim();
    if (s) bag.push(s);
    return bag;
  }

  // ── 배열: 각 원소 재귀 ───────────────────────────────────────────────────
  if (Array.isArray(node)) {
    for (const child of node) deepExtractText(child, bag, seen, depth + 1);
    return bag;
  }

  // ── 객체 ─────────────────────────────────────────────────────────────────
  if (typeof node === 'object') {
    // 순환 참조 방지
    if (seen.has(node as object)) return bag;
    seen.add(node as object);

    const o = node as Record<string, unknown>;

    // ── 텍스트 담당 키: string이면 직접 수집, object이면 재귀 하강 ───────
    // (예: section block = { text: { type:'mrkdwn', text:'실제문자열' } })
    for (const key of ['text', 'pretext', 'fallback', 'value'] as const) {
      const v = o[key];
      if (typeof v === 'string') {
        const s = v.trim();
        if (s) bag.push(s);
      } else if (v !== null && typeof v === 'object') {
        deepExtractText(v, bag, seen, depth + 1);
      }
    }

    // ── 컨테이너 배열 재귀 ──────────────────────────────────────────────
    // blocks · elements · attachments · fields · sections 를 포함한
    // 모든 Slack Block Kit / legacy attachment 컨테이너를 커버한다.
    for (const key of ['blocks', 'attachments', 'elements', 'fields', 'sections'] as const) {
      const arr = o[key];
      if (Array.isArray(arr)) deepExtractText(arr, bag, seen, depth + 1);
    }

    // ── 중첩 메시지 객체 (thread_broadcast / app_unfurl / message_changed) ─
    if (o.message !== null && typeof o.message === 'object') {
      deepExtractText(o.message, bag, seen, depth + 1);
    }
  }

  return bag;
}

// ─── [3] Slack 엔티티 언이스케이핑 ──────────────────────────────────────────

/**
 * Slack이 HTML 엔티티로 인코딩한 문자를 원래대로 복원한다.
 * &amp; 를 반드시 가장 먼저 처리해야 이중 디코딩 오류를 막을 수 있다.
 * (예: &amp;gt; → &gt; 로 끝나야 하는데 &gt; → > 로 오버-디코딩됨을 방지)
 *
 * 이 처리를 건너뛰면 clobe-parser 의 > 기반 blockquote 정규식이 작동하지 않는다.
 */
function unescapeSlackEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')   // 반드시 첫 번째
    .replace(/&lt;/g,  '<')
    .replace(/&gt;/g,  '>');
}

// ─── [4] 예약 정산 반영 ───────────────────────────────────────────────────────

async function applyToBooking(params: {
  bookingId:       string;
  transactionType: '입금' | '출금';
  amount:          number;
  isRefund:        boolean;
}): Promise<string | null> {
  const { bookingId, transactionType, amount, isRefund } = params;

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('total_price, total_cost, paid_amount, total_paid_out')
    .eq('id', bookingId)
    .single();

  if (!booking) return null;

  let paidAmount   = (booking as any).paid_amount    || 0;
  let totalPaidOut = (booking as any).total_paid_out || 0;

  if (transactionType === '입금') {
    paidAmount += amount;
  } else if (isRefund) {
    paidAmount = Math.max(0, paidAmount - amount);
  } else {
    totalPaidOut += amount;
  }

  const newStatus = calcPaymentStatus({
    total_price:    (booking as any).total_price,
    total_cost:     (booking as any).total_cost,
    paid_amount:    paidAmount,
    total_paid_out: totalPaidOut,
  });

  await supabaseAdmin
    .from('bookings')
    .update({
      paid_amount:    paidAmount,
      total_paid_out: totalPaidOut,
      payment_status: newStatus,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', bookingId);

  return newStatus;
}

// ─── [5] 백그라운드 처리 엔진 ────────────────────────────────────────────────

async function processWebhookEvent(
  event:   Record<string, any>,
  payload: Record<string, any>,
) {
  // ── 복합 이벤트 ID (멱등성 기반)
  const baseEventId =
    (payload.event_id as string) ||
    `${event.channel}_${event.event_ts ?? event.ts}`;

  // ── [v3-1] 재귀 딥 텍스트 추출
  const rawParts = deepExtractText(event);
  const rawJoined = rawParts.join('\n');

  // ── [v3-2] Slack 엔티티 언이스케이핑 (파서 전달 전 명시적 처리)
  const fullText = unescapeSlackEntities(rawJoined);

  console.log('[Webhook v5] deepExtractText 추출 조각 수:', rawParts.length);
  console.log('[Webhook v5] 언이스케이핑 후 텍스트 (앞 300자):\n', fullText.slice(0, 300));

  // 입금/출금 키워드 없으면 처리 불필요
  if (!fullText.includes('입금') && !fullText.includes('출금')) {
    console.log('[Webhook v5] 입출금 키워드 없음 — 스킵');
    return;
  }

  if (!isSupabaseConfigured) {
    console.error('[Webhook v5] Supabase 미설정 — 처리 중단');
    return;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[Webhook v5] SUPABASE_SERVICE_ROLE_KEY 환경변수 미설정 — RLS 우회 불가, 처리 중단');
    return;
  }

  // ── [v2-2] DLQ: 파싱 전 원본 메시지를 message_logs 에 선(先) Insert ────────
  // bank_transactions 는 amount_check 제약으로 amount=0 불가 → message_logs 사용
  // 파싱 실패 시 status='error' 로 어드민이 수동 확인 가능
  let dlqId: string | null = null;
  try {
    const { data: dlqRow, error: dlqError } = await supabaseAdmin
      .from('message_logs')
      .insert({
        content: fullText,
        payload: { event_id: baseEventId, event } as unknown,
        status:  'pending',
      } as never)
      .select('id')
      .maybeSingle();

    if (dlqError) {
      console.warn('[Webhook v5] DLQ Insert 실패 (계속 진행):', dlqError.message);
    } else {
      dlqId = (dlqRow as any)?.id ?? null;
      console.log(`[Webhook v5] DLQ 저장 완료 — message_logs id=${dlqId}`);
    }
  } catch (e: any) {
    console.warn('[Webhook v5] DLQ 예외 (계속 진행):', e?.message);
  }

  // ── 파싱 ─────────────────────────────────────────────────────────────────
  const transactions = parseClobeMessage(fullText);

  if (transactions.length === 0) {
    console.error('[Webhook v5] 파싱 결과 0건 — DLQ status=error 마킹');
    if (dlqId) {
      await supabaseAdmin
        .from('message_logs')
        .update({ status: 'error' } as never)
        .eq('id', dlqId);
    }
    return;
  }

  // ── 활성 예약 전체 로드 ───────────────────────────────────────────────────
  const { data: bookingsRaw } = await supabaseAdmin
    .from('bookings')
    .select(`
      id, booking_no, package_title,
      total_price, total_cost, paid_amount, total_paid_out,
      status, payment_status, actual_payer_name,
      customers!lead_customer_id(name)
    `)
    .in('status', ['pending', 'confirmed']);

  const bookings: BookingCandidate[] = (bookingsRaw || []).map((b: any) => ({
    id:                b.id,
    booking_no:        b.booking_no,
    package_title:     b.package_title,
    total_price:       b.total_price,
    total_cost:        b.total_cost,
    paid_amount:       b.paid_amount    || 0,
    total_paid_out:    b.total_paid_out || 0,
    status:            b.status,
    payment_status:    b.payment_status,
    actual_payer_name: b.actual_payer_name,
    customer_name:     b.customers?.name,
  }));

  // ── [v5] Promise.all 병렬 Upsert (Data-Driven 멱등성) ───────────────────
  await Promise.all(
    transactions.map(async (tx, i) => {
      try {
        // [v5] Data-Driven ID: 거래 내용이 같으면 무조건 동일 hash
        // Slack이 동일 이벤트를 event_id 달리해서 2회 전송해도 upsert가 차단
        const txEventId = createHash('sha256')
          .update(`${tx.type}|${tx.transactionDate}|${tx.name}|${tx.amount}`)
          .digest('hex');

        const isRefund = tx.type === '출금' && isRefundTransaction(tx.memo + ' ' + tx.name);

        // 매칭 로직
        let bestMatch:  ReturnType<typeof matchPaymentToBookings>[0] | null = null;
        let matchClass: 'auto' | 'review' | 'unmatched' = 'unmatched';
        let isFee      = false;
        let feeAmount  = 0;

        if (tx.type === '입금') {
          const candidates = matchPaymentToBookings({
            amount:     tx.amount,
            senderName: tx.name,
            bookings,
          });
          const guarded = applyDuplicateNameGuard(candidates);
          bestMatch  = guarded[0] ?? null;
          matchClass = bestMatch ? classifyMatch(bestMatch.confidence) : 'unmatched';

        } else if (tx.type === '출금' && !isRefund) {
          const costMatched = bookings.filter(b => {
            const cost = b.total_cost || 0;
            return cost > 0 && Math.abs(tx.amount - cost) <= 5_000;
          });
          if (costMatched.length === 1) {
            bestMatch = {
              booking:   costMatched[0],
              confidence: 0.65,
              reasons:   ['원가 금액 일치'],
              matchType: 'amount_only',
            };
            matchClass = 'review';

            const feeResult = isFeeTransaction({
              withdrawalAmount: tx.amount,
              expectedCost:     costMatched[0].total_cost || 0,
            });
            isFee     = feeResult.isFee;
            feeAmount = feeResult.feeAmount;
          }
        }

        // ── [v5] Upsert (onConflict: slack_event_id) ─────────────────────
        // ignoreDuplicates: true → 동일 hash 재진입 시 조용히 스킵 (first-write wins)
        const { data: inserted, error: insertError } = await supabaseAdmin
          .from('bank_transactions')
          .upsert(
            [{
              slack_event_id:    txEventId,
              raw_message:       fullText,
              transaction_type:  tx.type,
              amount:            tx.amount,
              counterparty_name: tx.name,
              memo:              tx.memo,
              received_at:       tx.transactionDate,
              booking_id:        matchClass === 'auto' ? (bestMatch?.booking.id ?? null) : null,
              is_refund:         isRefund,
              is_fee:            isFee,
              fee_amount:        feeAmount,
              match_status:      matchClass,
              match_confidence:  bestMatch?.confidence ?? 0,
              matched_by:        matchClass === 'auto' ? 'auto' : null,
              matched_at:        matchClass === 'auto' ? new Date().toISOString() : null,
              status:            'active', // 명시적 설정 (DB DEFAULT와 동일, 방어적 코딩)
            }],
            { onConflict: 'slack_event_id', ignoreDuplicates: true },
          )
          .select('id')
          .maybeSingle(); // ← ignoreDuplicates 시 0 rows → null (PGRST116 방지)

        if (insertError) {
          // PGRST116 = 0 rows returned (중복 무시된 경우) → 에러 아님, 조용히 스킵
          if (insertError.code === 'PGRST116') {
            console.log(`[Webhook v5] 중복 스킵 (PGRST116) hash=${txEventId.slice(0, 12)}...`);
            return;
          }
          console.error(
            `[Webhook v5] Upsert 실패 [${i}] hash=${txEventId.slice(0, 12)}...` +
            ` | message: ${insertError.message}` +
            ` | details: ${insertError.details ?? '없음'}` +
            ` | hint: ${(insertError as any).hint ?? '없음'}` +
            ` | code: ${insertError.code ?? '없음'}`,
          );
          return;
        }

        // inserted === null → 동일 hash 이미 존재 → 중복 스킵
        if (!inserted?.id) {
          // 진단 로그: 기존 row의 실제 match_status 조회 → 어느 탭에서 찾을지 안내
          const { data: existing } = await supabaseAdmin
            .from('bank_transactions')
            .select('match_status, status, counterparty_name, amount')
            .eq('slack_event_id', txEventId)
            .maybeSingle();
          const tabHint =
            existing?.match_status === 'unmatched' ? '→ 미매칭 탭' :
            existing?.match_status === 'review'    ? '→ 검토 탭' :
            existing?.match_status === 'auto' || existing?.match_status === 'manual' ? '→ 매칭완료 탭' : '';
          console.log(
            `[Webhook v5] 중복 스킵 hash=${txEventId.slice(0, 12)}` +
            ` | match_status=${existing?.match_status ?? '알 수 없음'} ${tabHint}` +
            ` | status=${existing?.status ?? '알 수 없음'}` +
            ` | ${existing?.counterparty_name ?? ''} ${(existing?.amount ?? 0).toLocaleString()}원`,
          );
          return;
        }

        // ── auto 매칭 시 예약 정산 반영 ────────────────────────────────────
        if (matchClass === 'auto' && bestMatch) {
          const newStatus = await applyToBooking({
            bookingId:       bestMatch.booking.id,
            transactionType: tx.type,
            amount:          tx.amount,
            isRefund,
          });

          await supabaseAdmin
            .from('bank_transactions')
            .update({ booking_id: bestMatch.booking.id })
            .eq('id', inserted.id);

          console.log(
            `[Webhook v5] 자동 정산 [${i + 1}/${transactions.length}]:` +
            ` ${bestMatch.booking.booking_no}` +
            ` | ${tx.type} ${tx.amount.toLocaleString()}원` +
            ` | 신뢰도 ${Math.round(bestMatch.confidence * 100)}%` +
            ` | 상태→${newStatus}`,
          );
        } else {
          console.log(
            `[Webhook v5] 저장 완료 [${i + 1}/${transactions.length}]:` +
            ` ${tx.type} ${tx.amount.toLocaleString()}원 (${tx.name}) → ${matchClass}`,
          );
        }
      } catch (err: any) {
        console.error(
          `[Webhook v5] 예외 발생 [${i}]:` +
          ` message: ${err?.message ?? String(err)}` +
          ` | details: ${err?.details ?? '없음'}` +
          ` | stack: ${err?.stack?.split('\n')[1]?.trim() ?? '없음'}`,
        );
      }
    }),
  );

  // ── DLQ 정리: 파싱+저장 성공 → message_logs status=processed ──────────────
  if (dlqId) {
    await supabaseAdmin
      .from('message_logs')
      .update({ status: 'processed' } as never)
      .eq('id', dlqId);
  }

  console.log(`[Webhook v5] DB 저장 결과: 총 ${transactions.length}건 처리 완료`);
}

// ─── [6] 메인 핸들러 ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: '잘못된 JSON' }, { status: 400 });
  }

  // 1. URL 검증 (Slack 앱 등록 시 1회)
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // 2. 서명 검증
  if (!await verifySlackSignature(request, rawBody)) {
    return NextResponse.json({ error: '서명 검증 실패' }, { status: 401 });
  }

  // 3. Slack 재전송(Retry) 즉시 ACK — 중복 처리 방지
  const retryNum = request.headers.get('x-slack-retry-num');
  if (retryNum && parseInt(retryNum) > 0) {
    console.log(`[Webhook v5] Retry #${retryNum} — 즉시 ACK`);
    return NextResponse.json({ ok: true, status: 'retry_ack' });
  }

  // event_callback 외 무시
  if (payload.type !== 'event_callback') {
    return NextResponse.json({ ok: true });
  }

  const event = payload.event as Record<string, any> | undefined;

  // [v2-1] subtype 체크 완전 제거
  //   기존: event.subtype 존재 시 DROP → Clobe AI(bot_message) 전량 소멸
  //   수정: message 타입이면 subtype 무관하게 통과
  if (!event || event.type !== 'message') {
    return NextResponse.json({ ok: true });
  }

  // [v4] 동기식 완전 실행 — processWebhookEvent 가 끝나야 응답 반환
  //      Vercel Serverless 런타임이 응답 즉시 프로세스를 종료(Freeze)하므로
  //      fire-and-forget 패턴은 DB Insert 가 실행되기 전에 kill 된다.
  try {
    await processWebhookEvent(event, payload);
  } catch (e: any) {
    console.error(
      '[Webhook v5] 처리 최상위 오류:',
      e?.message ?? String(e),
      e?.stack?.split('\n')[1]?.trim() ?? '',
    );
  }

  return NextResponse.json({ ok: true });
}
