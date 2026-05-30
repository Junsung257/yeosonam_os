import { createHash } from 'crypto';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';

const DEFAULT_META_GRAPH_VERSION = 'v23.0';

export type MetaStandardEvent =
  | 'PageView'
  | 'ViewContent'
  | 'Lead'
  | 'Purchase'
  | 'CompleteRegistration'
  | 'InitiateCheckout'
  | 'Contact';

export interface MetaConversionInput {
  eventName: MetaStandardEvent;
  eventId: string;
  eventSourceUrl?: string | null;
  actionSource?: 'website' | 'phone_call' | 'chat' | 'email' | 'system_generated' | 'business_messaging';
  productId?: string | null;
  bookingId?: string | null;
  sessionId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  value?: number | null;
  currency?: string | null;
  contentName?: string | null;
  contentCategory?: string | null;
  contentIds?: string[];
  contentType?: string | null;
  numItems?: number | null;
  email?: string | null;
  phone?: string | null;
  consentGranted: boolean;
  testEventCode?: string | null;
}

function sha256(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  return createHash('sha256').update(normalized).digest('hex');
}

function configuredPixelId() {
  return getSecret('META_PIXEL_ID') || getSecret('NEXT_PUBLIC_META_PIXEL_ID');
}

function configuredAccessToken() {
  return getSecret('META_CAPI_ACCESS_TOKEN') || getSecret('META_ACCESS_TOKEN') || getSecret('META_ADS_ACCESS_TOKEN');
}

function configuredGraphVersion() {
  return getSecret('META_GRAPH_API_VERSION') || DEFAULT_META_GRAPH_VERSION;
}

function buildMetaPayload(input: MetaConversionInput) {
  const userData: Record<string, unknown> = {};
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;
  if (input.clientIpAddress) userData.client_ip_address = input.clientIpAddress;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;
  const hashedEmail = sha256(input.email);
  const hashedPhone = sha256(input.phone?.replace(/[^\d+]/g, ''));
  if (hashedEmail) userData.em = [hashedEmail];
  if (hashedPhone) userData.ph = [hashedPhone];

  const customData: Record<string, unknown> = {
    currency: input.currency ?? 'KRW',
  };
  if (typeof input.value === 'number') customData.value = input.value;
  if (input.contentName) customData.content_name = input.contentName;
  if (input.contentCategory) customData.content_category = input.contentCategory;
  if (input.contentIds?.length) customData.content_ids = input.contentIds;
  if (input.contentType) customData.content_type = input.contentType;
  if (typeof input.numItems === 'number') customData.num_items = input.numItems;

  return {
    data: [
      {
        event_name: input.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: input.actionSource ?? 'website',
        event_source_url: input.eventSourceUrl ?? undefined,
        user_data: userData,
        custom_data: customData,
      },
    ],
    ...(input.testEventCode ? { test_event_code: input.testEventCode } : {}),
  };
}

function isMissingTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { code?: string; message?: string };
  return maybe.code === '42P01' || maybe.message?.includes('meta_conversion_events') === true;
}

async function logMetaConversion(input: MetaConversionInput, patch: Record<string, unknown>) {
  if (!isSupabaseConfigured) return;
  const { error } = await supabaseAdmin
    .from('meta_conversion_events')
    .upsert({
      event_id: input.eventId,
      event_name: input.eventName,
      action_source: input.actionSource ?? 'website',
      event_source_url: input.eventSourceUrl ?? null,
      product_id: input.productId ?? null,
      booking_id: input.bookingId ?? null,
      session_id: input.sessionId ?? null,
      fbp: input.fbp ?? null,
      fbc: input.fbc ?? null,
      value: input.value ?? null,
      currency: input.currency ?? 'KRW',
      consent_granted: input.consentGranted,
      payload: buildMetaPayload(input),
      ...patch,
    }, { onConflict: 'event_id', ignoreDuplicates: false });
  if (error && !isMissingTableError(error)) throw error;
}

export async function sendMetaConversion(input: MetaConversionInput) {
  const pixelId = configuredPixelId();
  const accessToken = configuredAccessToken();
  const payload = buildMetaPayload(input);

  if (!input.consentGranted) {
    await logMetaConversion(input, {
      sent_to_meta: false,
      error: 'marketing_consent_missing',
    });
    return { sent: false, skipped: 'marketing_consent_missing', event_id: input.eventId };
  }

  if (!pixelId || !accessToken) {
    await logMetaConversion(input, {
      sent_to_meta: false,
      error: 'meta_capi_not_configured',
    });
    return { sent: false, skipped: 'meta_capi_not_configured', event_id: input.eventId };
  }

  const url = `https://graph.facebook.com/${configuredGraphVersion()}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const responseBody = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
  await logMetaConversion(input, {
    sent_to_meta: response.ok,
    meta_status: response.status,
    meta_response: responseBody,
    error: response.ok ? null : `HTTP ${response.status}`,
    sent_at: response.ok ? new Date().toISOString() : null,
  });

  return {
    sent: response.ok,
    status: response.status,
    event_id: input.eventId,
    response: responseBody,
  };
}
