/**
 * Slack event webhook.
 *
 * Flow:
 * 1. Parse body and handle url_verification.
 * 2. Verify Slack HMAC signature when SLACK_SIGNING_SECRET is configured.
 * 3. ACK Slack retries immediately.
 * 4. Extract text from Slack event payload and hand off to the outbox ingest layer.
 */

import { createHmac } from 'crypto';
import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { getSecret } from '@/lib/secret-registry';
import { ingestSlackRawEvent } from '@/lib/slack-ingest';
import { isSupabaseConfigured } from '@/lib/supabase';
import { safeEqualString } from '@/lib/timing-safe';

async function verifySlackSignature(req: NextRequest, body: string): Promise<boolean> {
  const signingSecret = getSecret('SLACK_SIGNING_SECRET');
  if (!signingSecret) return true;

  const timestamp = req.headers.get('x-slack-request-timestamp');
  const slackSig = req.headers.get('x-slack-signature');
  if (!timestamp || !slackSig) return false;

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const hmac = createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex');

  return safeEqualString(`v0=${hmac}`, slackSig);
}

function deepExtractText(
  node: unknown,
  bag: string[] = [],
  seen: WeakSet<object> = new WeakSet(),
  depth: number = 0,
): string[] {
  if (depth > 12 || node === null || node === undefined) return bag;
  if (typeof node === 'string') {
    const value = node.trim();
    if (value) bag.push(value);
    return bag;
  }
  if (Array.isArray(node)) {
    for (const child of node) deepExtractText(child, bag, seen, depth + 1);
    return bag;
  }
  if (typeof node === 'object') {
    if (seen.has(node as object)) return bag;
    seen.add(node as object);
    const objectNode = node as Record<string, unknown>;
    for (const key of ['text', 'pretext', 'fallback', 'value'] as const) {
      const value = objectNode[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) bag.push(trimmed);
      } else if (value !== null && typeof value === 'object') {
        deepExtractText(value, bag, seen, depth + 1);
      }
    }
    for (const key of ['blocks', 'attachments', 'elements', 'fields', 'sections'] as const) {
      const value = objectNode[key];
      if (Array.isArray(value)) deepExtractText(value, bag, seen, depth + 1);
    }
    if (objectNode.message !== null && typeof objectNode.message === 'object') {
      deepExtractText(objectNode.message, bag, seen, depth + 1);
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

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }

  if (payload.type === 'url_verification') {
    return apiResponse({ challenge: payload.challenge });
  }

  if (!await verifySlackSignature(request, rawBody)) {
    return apiResponse({ error: 'signature verification failed' }, { status: 401 });
  }

  const retryNum = request.headers.get('x-slack-retry-num');
  if (retryNum && parseInt(retryNum, 10) > 0) {
    console.log(`[slack-webhook] retry ack: retry_num=${retryNum}`);
    return apiResponse({ ok: true, status: 'retry_ack' });
  }

  if (payload.type !== 'event_callback') {
    return apiResponse({ ok: true });
  }

  const event = payload.event as Record<string, unknown> | undefined;
  if (!event || event.type !== 'message') {
    return apiResponse({ ok: true });
  }

  if (!isSupabaseConfigured) {
    console.error('[slack-webhook] Supabase not configured; event ignored');
    return apiResponse({ ok: true });
  }

  const rawParts = deepExtractText(event);
  const fullText = unescapeSlackEntities(rawParts.join('\n'));

  const eventId = (payload.event_id as string | undefined) || `${event.channel}_${event.event_ts ?? event.ts}`;
  const channelId = (event.channel as string | undefined) || null;
  const messageTs = (event.ts as string | undefined) || null;
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
      `[slack-webhook] complete: rawEventId=${result.rawEventId} ` +
      `parsed=${result.parsedCount} status=${result.parseStatus} ` +
      `dup=${result.duplicated} errors=${result.errors.length}`,
    );
  } catch (error) {
    console.error('[slack-webhook] top-level ingest failed:', sanitizeDbError(error));
  }

  return apiResponse({ ok: true });
}
