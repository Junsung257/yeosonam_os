import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import type { AttributionSnapshot } from './types';
import { hashAnalyticsSearchQuery } from './query-hash';

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const safeText = z.string().trim().min(1).max(200).refine(
  value => !EMAIL_RE.test(value) && !PHONE_RE.test(value),
  'PII is not allowed in attribution values',
);
const touchSchema = z.object({
  source: safeText.optional(),
  medium: safeText.optional(),
  campaign: safeText.optional(),
  term: safeText.optional(),
  content: safeText.optional(),
  landingPath: z.string().startsWith('/').max(500).optional(),
  referrerHost: z.string().trim().max(200).optional(),
  occurredAt: z.string().datetime().optional(),
}).strict();

const attributionSchema = z.object({
  version: z.literal(1),
  attributionSessionId: z.string().uuid(),
  firstTouch: touchSchema.optional(),
  lastTouch: touchSchema.optional(),
  clickIds: z.object({
    gclid: z.string().regex(/^[A-Za-z0-9._~-]{3,256}$/).optional(),
    gbraid: z.string().regex(/^[A-Za-z0-9._~-]{3,256}$/).optional(),
    wbraid: z.string().regex(/^[A-Za-z0-9._~-]{3,256}$/).optional(),
    nclid: z.string().regex(/^[A-Za-z0-9._~-]{3,256}$/).optional(),
  }).strict().optional(),
  gaClientId: z.string().regex(/^\d+\.\d+$/).optional(),
  expiresAt: z.string().datetime(),
}).strict();

const BLOCKED_PAYLOAD_KEYS = /^(?:name|full_name|customer_name|phone|phone_number|email|address|passport|birth_date|message|memo|customer_note)$/i;

export function normalizeServerAttribution(value: unknown): AttributionSnapshot | null {
  const result = attributionSchema.safeParse(value);
  if (!result.success) return null;
  return result.data;
}

function assertNoPii(value: unknown, path = 'payload'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPii(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_PAYLOAD_KEYS.test(key)) {
      throw new Error(`PII key is not allowed in analytics server events: ${path}.${key}`);
    }
    assertNoPii(child, `${path}.${key}`);
  }
}

export type ServerAnalyticsEventName =
  | 'generate_lead'
  | 'purchase'
  | 'refund'
  | 'ysn_booking_confirmed';

export interface RecordServerAnalyticsEventInput {
  eventName: ServerAnalyticsEventName;
  idempotencyKey: string;
  sourceType: 'lead' | 'booking' | 'checkout_transaction' | 'ledger';
  sourceId: string;
  leadId?: string | null;
  bookingId?: string | null;
  productId?: string | null;
  transactionId?: string | null;
  assistingContentCreativeId?: string | null;
  searchQueryHash?: string | null;
  valueKrw?: number | null;
  attribution?: unknown;
  payload: Record<string, unknown>;
  occurredAt?: string;
  /** Internal pipeline probe. Stored for DB-boundary verification but never delivered externally. */
  synthetic?: boolean;
}

export function isSyntheticAnalyticsServerEvent(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).__synthetic === true,
  );
}

function hasAdsClickId(attribution: AttributionSnapshot | null): boolean {
  return Boolean(
    attribution?.clickIds?.gclid
    || attribution?.clickIds?.gbraid
    || attribution?.clickIds?.wbraid,
  );
}

function withoutRawSearchTerms(attribution: AttributionSnapshot | null): AttributionSnapshot | null {
  if (!attribution) return null;
  const stripTerm = (touch: AttributionSnapshot['firstTouch']) => {
    if (!touch) return undefined;
    const { term: _term, ...safeTouch } = touch;
    return safeTouch;
  };
  return {
    ...attribution,
    firstTouch: stripTerm(attribution.firstTouch),
    lastTouch: stripTerm(attribution.lastTouch),
  };
}

export async function recordServerAnalyticsEvent(
  input: RecordServerAnalyticsEventInput,
): Promise<{ id: string; idempotent: boolean }> {
  if (!input.idempotencyKey.trim() || !input.sourceId.trim()) {
    throw new Error('analytics event idempotencyKey and sourceId are required');
  }
  if (input.valueKrw != null && (!Number.isInteger(input.valueKrw) || input.valueKrw < 0)) {
    throw new Error('analytics event valueKrw must be a non-negative integer');
  }
  assertNoPii(input.payload);
  if ('__synthetic' in input.payload && input.synthetic !== true) {
    throw new Error('analytics synthetic marker is reserved for internal probes');
  }
  const normalizedAttribution = normalizeServerAttribution(input.attribution);
  const attribution = withoutRawSearchTerms(normalizedAttribution);
  const derivedSearchQueryHash = hashAnalyticsSearchQuery(
    normalizedAttribution?.lastTouch?.term ?? normalizedAttribution?.firstTouch?.term,
  );
  const searchQueryHash = typeof input.searchQueryHash === 'string'
    && /^[a-f0-9]{64}$/i.test(input.searchQueryHash)
    ? input.searchQueryHash.toLowerCase()
    : derivedSearchQueryHash;
  const row = {
    event_name: input.eventName,
    idempotency_key: input.idempotencyKey,
    source_type: input.sourceType,
    source_id: input.sourceId,
    lead_id: input.leadId ?? null,
    booking_id: input.bookingId ?? null,
    product_id: input.productId ?? null,
    transaction_id: input.transactionId ?? null,
    assisting_content_creative_id: input.assistingContentCreativeId ?? null,
    search_query_hash: searchQueryHash,
    currency: input.valueKrw == null ? null : 'KRW',
    value_krw: input.valueKrw ?? null,
    attribution_snapshot: attribution,
    event_payload: input.synthetic === true
      ? { ...input.payload, __synthetic: true }
      : input.payload,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin
    .from('analytics_server_events')
    .insert(row)
    .select('id')
    .single();

  let eventId: string;
  let idempotent = false;
  if (error?.code === '23505') {
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('analytics_server_events')
      .select('id')
      .eq('idempotency_key', input.idempotencyKey)
      .single();
    if (lookupError || !existing?.id) throw lookupError ?? error;
    eventId = existing.id as string;
    idempotent = true;
  } else {
    if (error || !data?.id) throw error ?? new Error('analytics server event insert failed');
    eventId = data.id as string;
  }

  const jobs: Array<Record<string, unknown>> = [];
  if (input.synthetic === true) {
    return { id: eventId, idempotent };
  }
  if (input.eventName !== 'generate_lead') {
    const ga4Ready = Boolean(
      process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.match(/^G-[A-Z0-9]+$/)
      && getSecret('GA4_MEASUREMENT_PROTOCOL_API_SECRET')
      && attribution?.gaClientId,
    );
    jobs.push({
      server_event_id: eventId,
      destination: 'ga4_measurement_protocol',
      status: ga4Ready ? 'planned' : 'blocked',
      idempotency_key: input.idempotencyKey,
      last_error: ga4Ready ? null : 'GA4 client_id or Measurement Protocol configuration is missing',
    });
  }
  jobs.push({
    server_event_id: eventId,
    destination: 'google_ads_data_manager',
    status: 'blocked',
    idempotency_key: input.idempotencyKey,
    last_error: hasAdsClickId(attribution)
      ? 'Google Ads Data Manager external account setup is pending'
      : 'Advertising consent/click identifier is unavailable',
  });

  const { error: jobError } = await supabaseAdmin
    .from('analytics_delivery_jobs')
    .upsert(jobs, {
      onConflict: 'destination,idempotency_key',
      ignoreDuplicates: true,
    });
  if (jobError) throw jobError;

  return { id: eventId, idempotent };
}

export async function processGa4DeliveryJobs(limit = 20): Promise<{
  attempted: number;
  sent: number;
  failed: number;
}> {
  const measurementId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
  const apiSecret = getSecret('GA4_MEASUREMENT_PROTOCOL_API_SECRET');
  if (!measurementId?.match(/^G-[A-Z0-9]+$/) || !apiSecret) {
    return { attempted: 0, sent: 0, failed: 0 };
  }

  const { data: jobs, error } = await supabaseAdmin
    .from('analytics_delivery_jobs')
    .select('id, attempt_count, server_event_id, analytics_server_events(event_name, event_payload, attribution_snapshot, occurred_at)')
    .eq('destination', 'ga4_measurement_protocol')
    .in('status', ['planned', 'failed'])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw error;

  let sent = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    const claimTime = new Date().toISOString();
    const { data: claimed } = await supabaseAdmin
      .from('analytics_delivery_jobs')
      .update({ status: 'processing', last_attempt_at: claimTime, updated_at: claimTime })
      .eq('id', job.id)
      .in('status', ['planned', 'failed'])
      .select('id')
      .maybeSingle();
    if (!claimed) continue;

    const related = Array.isArray(job.analytics_server_events)
      ? job.analytics_server_events[0]
      : job.analytics_server_events;
    const attribution = normalizeServerAttribution(related?.attribution_snapshot);
    if (!related || !attribution?.gaClientId) {
      await supabaseAdmin.from('analytics_delivery_jobs').update({
        status: 'blocked',
        last_error: 'GA4 client_id is missing',
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      failed += 1;
      continue;
    }

    const attemptCount = Number(job.attempt_count ?? 0) + 1;
    const attemptedAt = new Date();
    try {
      const response = await fetch(
        `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_id: attribution.gaClientId,
            timestamp_micros: String(Date.parse(related.occurred_at) * 1_000),
            events: [{ name: related.event_name, params: related.event_payload }],
          }),
        },
      );
      if (!response.ok) throw new Error(`GA4 Measurement Protocol HTTP ${response.status}`);
      await supabaseAdmin.from('analytics_delivery_jobs').update({
        status: 'sent',
        attempt_count: attemptCount,
        last_attempt_at: attemptedAt.toISOString(),
        sent_at: attemptedAt.toISOString(),
        next_attempt_at: null,
        last_error: null,
        updated_at: attemptedAt.toISOString(),
      }).eq('id', job.id);
      sent += 1;
    } catch (deliveryError) {
      const retryMinutes = Math.min(360, 2 ** Math.min(attemptCount, 8));
      await supabaseAdmin.from('analytics_delivery_jobs').update({
        status: 'failed',
        attempt_count: attemptCount,
        last_attempt_at: attemptedAt.toISOString(),
        next_attempt_at: new Date(attemptedAt.getTime() + retryMinutes * 60_000).toISOString(),
        last_error: deliveryError instanceof Error ? deliveryError.message.slice(0, 500) : 'GA4 delivery failed',
        updated_at: attemptedAt.toISOString(),
      }).eq('id', job.id);
      failed += 1;
    }
  }
  return { attempted: jobs?.length ?? 0, sent, failed };
}
