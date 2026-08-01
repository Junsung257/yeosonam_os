import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const REVENUE_FUNNEL_EVENT_TYPES = [
  'offer_viewed',
  'lead_started',
  'lead_submitted',
  'kakao_clicked',
  'operator_contacted',
  'quote_sent',
  'quote_accepted',
  'booking_created',
  'payment_received',
  'booking_confirmed',
  'booking_cancelled',
  'trip_completed',
  'review_requested',
  'review_submitted',
] as const;

export type RevenueFunnelEventType = (typeof REVENUE_FUNNEL_EVENT_TYPES)[number];
export type RevenueConsentState = 'granted' | 'denied' | 'not_required' | 'unknown';

export interface RevenueFunnelEventInput {
  eventType: RevenueFunnelEventType;
  source: string;
  offerId?: string | null;
  leadId?: string | null;
  bookingId?: string | null;
  tenantId?: string | null;
  sessionId?: string | null;
  consentState: RevenueConsentState;
  dedupeKey: string;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
  firstTouch?: string | null;
  lastTouch?: string | null;
  clickIds?: Record<string, string | null | undefined> | null;
}

type ValidationResult =
  | { ok: true; value: RevenueFunnelEventInput }
  | { ok: false; code: 'INVALID_EVENT' | 'INVALID_INPUT'; message: string };

const EVENT_TYPES = new Set<string>(REVENUE_FUNNEL_EVENT_TYPES);
const CONSENT_STATES = new Set<string>(['granted', 'denied', 'not_required', 'unknown']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function optionalUuid(value: unknown): string | null {
  const normalized = text(value, 36);
  return normalized && UUID_PATTERN.test(normalized) ? normalized : null;
}

function clickIds(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    ['gclid', 'fbclid', 'ttclid', 'msclkid']
      .map((key) => [key, text(source[key], 256)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
}

export function validateRevenueFunnelEventInput(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_INPUT', message: '이벤트 형식이 올바르지 않습니다.' };
  }

  const row = input as Record<string, unknown>;
  const eventType = text(row.eventType, 64);
  if (!eventType || !EVENT_TYPES.has(eventType)) {
    return { ok: false, code: 'INVALID_EVENT', message: '지원하지 않는 이벤트입니다.' };
  }

  const source = text(row.source, 64);
  const dedupeKey = text(row.dedupeKey, 200);
  const consentState = text(row.consentState, 32);
  if (!source || !dedupeKey || !consentState || !CONSENT_STATES.has(consentState)) {
    return { ok: false, code: 'INVALID_INPUT', message: '필수 이벤트 정보가 없습니다.' };
  }

  for (const field of ['offerId', 'leadId', 'bookingId', 'tenantId'] as const) {
    if (row[field] != null && !optionalUuid(row[field])) {
      return { ok: false, code: 'INVALID_INPUT', message: `${field} 형식이 올바르지 않습니다.` };
    }
  }

  return {
    ok: true,
    value: {
      eventType: eventType as RevenueFunnelEventType,
      source,
      offerId: optionalUuid(row.offerId),
      leadId: optionalUuid(row.leadId),
      bookingId: optionalUuid(row.bookingId),
      tenantId: optionalUuid(row.tenantId),
      sessionId: text(row.sessionId, 128),
      consentState: consentState as RevenueConsentState,
      dedupeKey,
      medium: text(row.medium, 128),
      campaign: text(row.campaign, 256),
      content: text(row.content, 256),
      term: text(row.term, 256),
      referrer: text(row.referrer, 1_000),
      landingPath: text(row.landingPath, 1_000),
      firstTouch: text(row.firstTouch, 1_000),
      lastTouch: text(row.lastTouch, 1_000),
      clickIds: clickIds(row.clickIds),
    },
  };
}

export async function persistRevenueFunnelEvent(input: RevenueFunnelEventInput): Promise<{
  ok: boolean;
  error?: unknown;
}> {
  if (!isSupabaseConfigured) return { ok: false, error: new Error('Supabase is not configured') };

  const payload = {
    medium: input.medium ?? null,
    campaign: input.campaign ?? null,
    content: input.content ?? null,
    term: input.term ?? null,
    referrer: input.referrer ?? null,
    landing_path: input.landingPath ?? null,
    first_touch: input.firstTouch ?? null,
    last_touch: input.lastTouch ?? null,
    click_ids: input.clickIds ?? {},
  };

  try {
    const { error } = await supabaseAdmin
      .from('customer_events')
      .upsert({
        session_id: input.sessionId ?? null,
        event_type: input.eventType,
        channel: input.eventType === 'kakao_clicked' ? 'kakao' : 'web',
        tenant_id: input.tenantId ?? null,
        occurred_at: new Date().toISOString(),
        source: input.source,
        offer_id: input.offerId ?? null,
        lead_id: input.leadId ?? null,
        booking_id: input.bookingId ?? null,
        consent_state: input.consentState,
        dedupe_key: input.dedupeKey,
        payload,
      }, {
        onConflict: 'source,dedupe_key',
        ignoreDuplicates: true,
      });

    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
