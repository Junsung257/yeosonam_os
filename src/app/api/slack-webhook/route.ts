/**
 * 여소남 OS — 슬랙 입출금 웹훅 v6 (Outbox 패턴)
 *
 * ── v6 설계 원칙 ─────────────────────────────────────────────────────────────
 * 1. **원문 먼저** — 파싱 전에 slack_raw_events에 저장. 파싱 실패해도 원문은 산다.
 * 2. **Webhook은 얇게** — 서명 검증 + Outbox 저장 + 파싱 트리거만.
 *    실제 파싱/매칭/예약반영 로직은 src/lib/slack-ingest.ts 로 이관.
 * 3. **Gap-fill이 백업** — 이 핸들러가 죽어도 /api/cron/slack-gap-fill 이
 *    conversations.history 로 재스캔해서 누락을 메운다.
 * 4. **멱등성** — (event_id) 또는 (channel_id, message_ts) 로 중복 차단.
 * 5. **동기식 완전 실행** — Vercel Serverless 강제 종료 방어 (v4 유지).
 *
 * 처리 흐름:
 *  1. url_verification → challenge 즉시 반환
 *  2. HMAC-SHA256 서명 검증
 *  3. X-Slack-Retry-Num > 0 → 즉시 ACK (중복 방지)
 *  4. deepExtractText → Slack 엔티티 언이스케이핑 → fullText
 *  5. ingestSlackRawEvent() — outbox 저장 + 파싱 + 매칭 일괄 처리
 *  6. 200 OK
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured } from '@/lib/supabase';
import { ingestSlackRawEvent } from '@/lib/slack-ingest';

// ─── [1] Slack HMAC-SHA256 서명 검증 ─────────────────────────────────────────

async function verifySlackSignature(req: NextRequest, body: string): Promise<boolean> {
  const signingSecret = getSecret('SLACK_SIGNING_SECRET');
  if (!signingSecret) return true; // 개발 환경: 서명 없으면 통과

  const timestamp = req.headers.get('x-slack-request-timestamp');
  const slackSig = req.headers.get('x-slack-signature');
  if (!timestamp || !slackSig) return false;

  // 재전송 공격 방지: 5분 이내 요청만 허용
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const hmac = createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex');

  return `v0=${hmac}` === slackSig;
}

// ─── [2] 재귀 딥 텍스트 추출기 ───────────────────────────────────────────────

function deepExtractText(
  node: unknown,
  bag: string[] = [],
  seen: WeakSet<object> = new WeakSet(),
  depth: number = 0,
): string[] {
  if (depth > 12 || node === null || node === undefined) return bag;
  if (typeof node === 'string') {
    const s = node.trim();
    if (s) bag.push(s);
    return bag;
  }
  if (Array.isArray(node)) {
    for (const child of node) deepExtractText(child, bag, seen, depth + 1);
    return bag;
  }
  if (typeof node === 'object') {
    if (seen.has(node as object)) return bag;
    seen.add(node as object);
    const o = node as Record<string, unknown>;
    for (const key of ['text', 'pretext', 'fallback', 'value'] as const) {
      const v = o[key];
      if (typeof v === 'string') {
        const s = v.trim();
        if (s) bag.push(s);
      } else if (v !== null && typeof v === 'object') {
        deepExtractText(v, bag, seen, depth + 1);
      }
    }
    for (const key of ['blocks', 'attachments', 'elements', 'fields', 'sections'] as const) {
      const arr = o[key];
      if (Array.isArray(arr)) deepExtractText(arr, bag, seen, depth + 1);
    }
    if (o.message !== null && typeof o.message === 'object') {
      deepExtractText(o.message, bag, seen, depth + 1);
    }
  }
  return bag;
}

function unescapeSlackEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ─── [3] 메인 핸들러 ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: '잘못된 JSON' }, { status: 400 });
  }

  // URL 검증 (최초 1회)
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // 서명 검증
  if (!await verifySlackSignature(request, rawBody)) {
    return NextResponse.json({ error: '서명 검증 실패' }, { status: 401 });
  }

  // Slack 재전송 즉시 ACK
  const retryNum = request.headers.get('x-slack-retry-num');
  if (retryNum && parseInt(retryNum) > 0) {
    console.log(`[Webhook v6] Retry #${retryNum} — 즉시 ACK (원문은 첫 요청에서 이미 저장됨)`);
    return NextResponse.json({ ok: true, status: 'retry_ack' });
  }

  if (payload.type !== 'event_callback') {
    return NextResponse.json({ ok: true });
  }

  const event = payload.event as Record<string, any> | undefined;
  if (!event || event.type !== 'message') {
    return NextResponse.json({ ok: true });
  }

  if (!isSupabaseConfigured) {
    console.error('[Webhook v6] Supabase 미설정 — 처리 불가');
    return NextResponse.json({ ok: true });
  }

  // ── 텍스트 추출 + 엔티티 언이스케이핑 ─────────────────────────────────────
  const rawParts = deepExtractText(event);
  const fullText = unescapeSlackEntities(rawParts.join('\n'));

  const eventId = (payload.event_id as string) || `${event.channel}_${event.event_ts ?? event.ts}`;
  const channelId = (event.channel as string) || null;
  const messageTs = (event.ts as string) || null;
  const slackMessageAt = messageTs ? new Date(Number(messageTs) * 1000).toISOString() : null;

  try {
    const result = await ingestSlackRawEvent({
      source: 'webhook',
      eventId,
      channelId,
      messageTs,
      rawPayload: payload,
      extractedText: fullText,
      slackMessageAt,
    });

    console.log(
      `[Webhook v6] 완료: rawEventId=${result.rawEventId} ` +
      `parsed=${result.parsedCount} status=${result.parseStatus} ` +
      `dup=${result.duplicated}${result.errors.length ? ' errors=' + result.errors.join('|') : ''}`,
    );
  } catch (e: any) {
    // 여기 도달하면 ingest 내부 catch가 못 잡은 예외 — 원문은 outbox 테이블에
    // 이미 저장됐을 수 있으므로 gap-fill/dlq-replay 크론이 복구
    console.error('[Webhook v6] 최상위 예외:', e?.message ?? String(e));
  }

  return NextResponse.json({ ok: true });
}
