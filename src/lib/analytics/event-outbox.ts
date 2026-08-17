import { supabaseAdmin } from '@/lib/supabase';
import {
  recordServerAnalyticsEvent,
  type RecordServerAnalyticsEventInput,
  type ServerAnalyticsEventName,
} from './server-events';

interface AnalyticsOutboxRow {
  id: string;
  event_name: ServerAnalyticsEventName;
  idempotency_key: string;
  source_type: RecordServerAnalyticsEventInput['sourceType'];
  source_id: string;
  lead_id: string | null;
  booking_id: string | null;
  product_id: string | null;
  transaction_id: string | null;
  assisting_content_creative_id: string | null;
  search_query_hash: string | null;
  value_krw: number | null;
  attribution_snapshot: unknown;
  event_payload: Record<string, unknown>;
  occurred_at: string;
  attempt_count: number;
}

const MAX_ATTEMPTS = 8;
const OUTBOX_COLUMNS = [
  'id',
  'event_name',
  'idempotency_key',
  'source_type',
  'source_id',
  'lead_id',
  'booking_id',
  'product_id',
  'transaction_id',
  'assisting_content_creative_id',
  'search_query_hash',
  'value_krw',
  'attribution_snapshot',
  'event_payload',
  'occurred_at',
  'attempt_count',
].join(', ');

export function analyticsOutboxRetryAt(attemptCount: number, now = new Date()): string {
  const safeAttempt = Math.max(1, Math.min(Math.trunc(attemptCount), MAX_ATTEMPTS));
  const delayMinutes = Math.min(6 * 60, 2 ** (safeAttempt - 1));
  return new Date(now.getTime() + delayMinutes * 60_000).toISOString();
}

function toRecordInput(row: AnalyticsOutboxRow): RecordServerAnalyticsEventInput {
  return {
    eventName: row.event_name,
    idempotencyKey: row.idempotency_key,
    sourceType: row.source_type,
    sourceId: row.source_id,
    leadId: row.lead_id,
    bookingId: row.booking_id,
    productId: row.product_id,
    transactionId: row.transaction_id,
    assistingContentCreativeId: row.assisting_content_creative_id,
    searchQueryHash: row.search_query_hash,
    valueKrw: row.value_krw,
    attribution: row.attribution_snapshot,
    payload: row.event_payload,
    occurredAt: row.occurred_at,
  };
}

async function recoverStaleClaims(now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
  const { error } = await supabaseAdmin
    .from('analytics_server_event_outbox')
    .update({
      status: 'failed',
      last_error: 'processing lease expired',
      next_attempt_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('status', 'processing')
    .lt('last_attempt_at', staleBefore);
  if (error) throw error;
}

export async function processAnalyticsEventOutbox(limit = 20): Promise<{
  attempted: number;
  processed: number;
  failed: number;
  dead: number;
}> {
  const now = new Date();
  await recoverStaleClaims(now);
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const { data, error } = await supabaseAdmin
    .from('analytics_server_event_outbox')
    .select(OUTBOX_COLUMNS)
    .in('status', ['pending', 'failed'])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now.toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(safeLimit);
  if (error) throw error;

  let attempted = 0;
  let processed = 0;
  let failed = 0;
  let dead = 0;
  for (const rawRow of data ?? []) {
    const row = rawRow as unknown as AnalyticsOutboxRow;
    const attemptCount = Number(row.attempt_count ?? 0) + 1;
    const claimTime = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('analytics_server_event_outbox')
      .update({
        status: 'processing',
        attempt_count: attemptCount,
        last_attempt_at: claimTime,
        updated_at: claimTime,
      })
      .eq('id', row.id)
      .in('status', ['pending', 'failed'])
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;

    attempted += 1;
    try {
      await recordServerAnalyticsEvent(toRecordInput(row));
      const completedAt = new Date().toISOString();
      const { error: completionError } = await supabaseAdmin
        .from('analytics_server_event_outbox')
        .update({
          status: 'processed',
          processed_at: completedAt,
          next_attempt_at: null,
          last_error: null,
          updated_at: completedAt,
        })
        .eq('id', row.id)
        .eq('status', 'processing');
      if (completionError) throw completionError;
      processed += 1;
    } catch (eventError) {
      const isDead = attemptCount >= MAX_ATTEMPTS;
      const failedAt = new Date();
      const { error: failureError } = await supabaseAdmin
        .from('analytics_server_event_outbox')
        .update({
          status: isDead ? 'dead' : 'failed',
          next_attempt_at: isDead ? null : analyticsOutboxRetryAt(attemptCount, failedAt),
          last_error: eventError instanceof Error
            ? eventError.message.slice(0, 500)
            : 'analytics event processing failed',
          updated_at: failedAt.toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'processing');
      if (failureError) throw failureError;
      if (isDead) dead += 1;
      else failed += 1;
    }
  }

  return { attempted, processed, failed, dead };
}
