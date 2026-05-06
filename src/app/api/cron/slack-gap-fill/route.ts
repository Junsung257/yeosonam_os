/**
 * GET /api/cron/slack-gap-fill
 *
 * 🎯 목적: Slack 웹훅이 한 건이라도 놓쳤을 때 누락을 자동 복구.
 *
 * 동작:
 *   1. slack_raw_events에서 가장 최근 수신한 message_ts 조회 (최근 36시간 내)
 *   2. Slack conversations.history API로 그 이후 메시지 재스캔
 *   3. 각 메시지를 ingestSlackRawEvent() 로 Outbox에 upsert
 *      - 이미 저장된 (channel_id, message_ts)는 자동 dedupe
 *   4. 누락된 건만 새로 파싱/매칭됨
 *
 * Vercel Cron: 매 15분 (*\/15 * * * *)
 *
 * 필요한 환경변수:
 *   - SLACK_BOT_TOKEN   : xoxb-... (conversations.history scope 필요)
 *   - SLACK_CHANNEL_ID  : C0XXXXXX (Clobe.ai가 포스팅하는 채널)
 *   - CRON_SECRET       : Vercel cron 인증
 *
 * Slack API 제한 (2025-05 기준):
 *   - 비-Marketplace 앱: conversations.history 분당 1회, 요청당 15건
 *   - Marketplace 앱: Tier 3 (50+/min)
 *   - 15분 주기이면 제한 여유 있음
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { ingestSlackRawEvent } from '@/lib/slack-ingest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SLACK_API = 'https://slack.com/api/conversations.history';
const LOOKBACK_HOURS = 36; // 최근 36시간이 gap-fill 대상 (웹훅 장애가 길어도 커버)

interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  blocks?: unknown[];
  attachments?: unknown[];
  channel?: string;
}

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
}

// ─── 텍스트 추출 (webhook과 동일 로직, lib로 분리하면 더 깨끗하지만 짧음) ───

function deepExtractText(node: unknown, bag: string[] = [], seen = new WeakSet<object>(), depth = 0): string[] {
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
  }
  return bag;
}

function unescapeSlackEntities(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// ─── 메인 핸들러 ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  const botToken = getSecret('SLACK_BOT_TOKEN');
  const channelId = getSecret('SLACK_CHANNEL_ID');

  if (!botToken || !channelId) {
    console.warn('[slack-gap-fill] SLACK_BOT_TOKEN/CHANNEL_ID 미설정 — 스킵 (gap-fill 비활성)');
    return NextResponse.json({ ok: true, skipped: 'slack credentials missing' });
  }

  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const startedAt = Date.now();
  const summary = {
    scanned: 0,
    ingested: 0,
    duplicated: 0,
    parsed: 0,
    failed: 0,
    errors: [] as string[],
    oldest_ts: null as string | null,
    latest_ts: null as string | null,
  };

  try {
    // ── [1] 마지막 수신 ts 결정 ─────────────────────────────────────────────
    // 우선순위: slack_raw_events.message_ts 최대값 > LOOKBACK_HOURS
    const lookbackSec = Math.floor((Date.now() - LOOKBACK_HOURS * 3600_000) / 1000);

    const { data: maxRow } = await supabaseAdmin
      .from('slack_raw_events')
      .select('message_ts')
      .eq('channel_id', channelId)
      .order('message_ts', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastTs = (maxRow as any)?.message_ts;
    const oldest = lastTs ? String(lastTs) : String(lookbackSec);
    summary.oldest_ts = oldest;

    // ── [2] conversations.history 호출 (페이지네이션 지원) ────────────────
    let cursor: string | undefined;
    const allMessages: SlackMessage[] = [];

    // 최대 5 페이지까지 (100건 * 5 = 500건) — 그 이상은 다음 주기에 처리
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({
        channel: channelId,
        oldest, // 이 ts 이후 메시지만
        limit: '100',
        inclusive: 'false', // oldest ts 자체는 제외 (이미 처리됨)
      });
      if (cursor) params.set('cursor', cursor);

      const resp = await fetch(`${SLACK_API}?${params}`, {
        headers: { Authorization: `Bearer ${botToken}` },
      });

      if (!resp.ok) {
        const txt = await resp.text();
        summary.errors.push(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        break;
      }

      const data = (await resp.json()) as SlackHistoryResponse;

      if (!data.ok) {
        summary.errors.push(`Slack API error: ${data.error}`);
        // rate_limited인 경우 재시도는 다음 크론 주기에 맡김
        if (data.error === 'ratelimited') {
          console.warn('[slack-gap-fill] rate_limited — 다음 주기에 재개');
        }
        break;
      }

      const messages = data.messages || [];
      allMessages.push(...messages);

      if (!data.has_more || !data.response_metadata?.next_cursor) break;
      cursor = data.response_metadata.next_cursor;
    }

    summary.scanned = allMessages.length;
    if (allMessages.length > 0) {
      // Slack은 최신순으로 반환하므로 역순 (오래된 것부터) 처리
      allMessages.sort((a, b) => Number(a.ts) - Number(b.ts));
      summary.latest_ts = allMessages[allMessages.length - 1].ts;
    }

    // ── [3] 각 메시지를 Outbox로 injest ────────────────────────────────────
    for (const msg of allMessages) {
      try {
        const bag = deepExtractText(msg);
        const fullText = unescapeSlackEntities(bag.join('\n'));

        const slackMessageAt = new Date(Number(msg.ts) * 1000).toISOString();

        const result = await ingestSlackRawEvent({
          source: 'gap_fill',
          eventId: null,
          channelId,
          messageTs: msg.ts,
          rawPayload: msg as unknown as Record<string, unknown>,
          extractedText: fullText,
          slackMessageAt,
        });

        if (result.duplicated) {
          summary.duplicated++;
        } else {
          summary.ingested++;
          if (result.parseStatus === 'parsed') summary.parsed += result.parsedCount;
          else if (result.parseStatus === 'failed') summary.failed++;
        }
      } catch (e: any) {
        summary.errors.push(`msg[${msg.ts}]: ${e?.message ?? String(e)}`);
      }
    }

    const elapsed = Date.now() - startedAt;
    console.log(
      `[slack-gap-fill] ${elapsed}ms — scanned=${summary.scanned} ingested=${summary.ingested} ` +
      `duplicated=${summary.duplicated} parsed=${summary.parsed} failed=${summary.failed}`,
    );

    return NextResponse.json({ ok: true, elapsed_ms: elapsed, ...summary });
  } catch (e: any) {
    console.error('[slack-gap-fill] 최상위 예외:', e?.message ?? String(e));
    return NextResponse.json({ error: e?.message ?? 'gap-fill 실패' }, { status: 500 });
  }
}
