import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';

export type AffiliateFunnelEventName =
  | 'affiliate_application_started'
  | 'affiliate_application_submitted'
  | 'affiliate_application_needs_info'
  | 'affiliate_application_approved'
  | 'affiliate_invitation_sent'
  | 'affiliate_invitation_opened'
  | 'affiliate_session_created'
  | 'affiliate_onboarding_step_completed'
  | 'affiliate_product_viewed'
  | 'affiliate_product_saved'
  | 'affiliate_publication_created'
  | 'affiliate_publication_test_passed'
  | 'affiliate_publication_published'
  | 'affiliate_touchpoint_received'
  | 'affiliate_touchpoint_validated'
  | 'affiliate_attribution_decided'
  | 'affiliate_booking_attributed'
  | 'commission_ledger_entry_created'
  | 'settlement_run_created'
  | 'settlement_held'
  | 'settlement_ready'
  | 'payout_completed'
  | 'affiliate_dispute_opened'
  | 'affiliate_dispute_resolved';

type FunnelEventInput = {
  eventName: AffiliateFunnelEventName;
  affiliateId?: string | null;
  publicationId?: string | null;
  productId?: string | null;
  bookingId?: string | null;
  settlementRunId?: string | null;
  policyVersion?: string | null;
  actorType?: 'affiliate' | 'admin' | 'system' | 'customer' | 'cron';
  traceId?: string;
  idempotencyKey?: string | null;
  payload?: Record<string, unknown>;
};

function normalizeTraceId(value: string | null | undefined): string {
  const candidate = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

/**
 * Funnel telemetry is deliberately best-effort: a reporting outage must not
 * turn a successful application, click, or payout command into a user error.
 * No raw phone, email, bank, customer, IP, or user-agent value belongs here.
 */
export async function recordAffiliateFunnelEvent(input: FunnelEventInput): Promise<void> {
  const { error } = await supabaseAdmin.from('affiliate_funnel_events').insert({
    event_name: input.eventName,
    affiliate_id: input.affiliateId || null,
    publication_id: input.publicationId || null,
    product_id: input.productId || null,
    booking_id: input.bookingId || null,
    settlement_run_id: input.settlementRunId || null,
    policy_version: input.policyVersion || null,
    actor_type: input.actorType || 'system',
    trace_id: normalizeTraceId(input.traceId),
    event_schema_version: 1,
    payload: input.payload || {},
    idempotency_key: input.idempotencyKey || null,
  } as never);
  if (error && !String(error.message || '').includes('duplicate key')) {
    console.warn('[affiliate-funnel-event]', { event: input.eventName, code: 'EVENT_WRITE_FAILED' });
  }
}
