import { type NextRequest, NextResponse } from 'next/server';
import { sendMetaConversion, type MetaStandardEvent } from '@/lib/meta-conversions';
import { rateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_EVENTS = new Set<MetaStandardEvent>([
  'PageView',
  'ViewContent',
  'Lead',
  'Purchase',
  'CompleteRegistration',
  'InitiateCheckout',
  'Contact',
]);
const SAFE_ID_RE = /^[A-Za-z0-9:._-]{1,200}$/;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;

function readClientIp(request: NextRequest) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null
  );
}

function eventAllowed(value: unknown): value is MetaStandardEvent {
  return typeof value === 'string' && ALLOWED_EVENTS.has(value as MetaStandardEvent);
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string =>
      typeof item === 'string' && SAFE_ID_RE.test(item),
    ).slice(0, 50)
    : [];
}

function safeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, 200);
  if (!normalized || EMAIL_RE.test(normalized) || PHONE_RE.test(normalized)) return null;
  return normalized;
}

function safeEventSourceUrl(request: NextRequest, value: unknown): string {
  const candidates = [
    typeof value === 'string' ? value : null,
    request.headers.get('referer'),
  ];
  const configuredHost = (() => {
    try {
      return new URL(
        process.env.NEXT_PUBLIC_SITE_URL
        || process.env.NEXT_PUBLIC_BASE_URL
        || request.nextUrl.origin,
      ).hostname;
    } catch {
      return request.nextUrl.hostname;
    }
  })();
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (
        (url.protocol === 'https:' || url.protocol === 'http:')
        && (url.hostname === configuredHost || url.hostname === request.nextUrl.hostname)
      ) {
        return `${url.origin}${url.pathname.slice(0, 500)}`;
      }
    } catch {
      // Try the next trusted source.
    }
  }
  return `${request.nextUrl.origin}/`;
}

export async function POST(request: NextRequest) {
  const limited = await rateLimit(request, {
    limit: 60,
    window: 60,
    prefix: 'rl-meta-conversion',
  });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!eventAllowed((body as { event_name?: unknown }).event_name)) {
    return NextResponse.json({ error: 'Unsupported event_name' }, { status: 400 });
  }

  const eventId = typeof (body as { event_id?: unknown }).event_id === 'string'
    && SAFE_ID_RE.test((body as { event_id: string }).event_id)
    ? (body as { event_id: string }).event_id
    : crypto.randomUUID();

  const consentGranted = request.cookies.get('ys_marketing_consent')?.value === 'true';
  const result = await sendMetaConversion({
    eventName: (body as { event_name: MetaStandardEvent }).event_name,
    eventId,
    eventSourceUrl: safeEventSourceUrl(request, body.event_source_url),
    actionSource: 'website',
    productId: typeof body.product_id === 'string' && SAFE_ID_RE.test(body.product_id) ? body.product_id : null,
    bookingId: typeof body.booking_id === 'string' && SAFE_ID_RE.test(body.booking_id) ? body.booking_id : null,
    sessionId: request.cookies.get('ys_session_id')?.value ?? null,
    fbp: request.cookies.get('_fbp')?.value ?? null,
    fbc: request.cookies.get('_fbc')?.value ?? null,
    clientIpAddress: readClientIp(request),
    clientUserAgent: request.headers.get('user-agent'),
    value: typeof body.value === 'number'
      && Number.isFinite(body.value)
      && body.value >= 0
      ? Math.min(body.value, 10_000_000_000)
      : null,
    currency: 'KRW',
    contentName: safeText(body.content_name),
    contentCategory: safeText(body.content_category),
    contentIds: arrayOfStrings(body.content_ids),
    contentType: safeText(body.content_type),
    numItems: typeof body.num_items === 'number'
      && Number.isInteger(body.num_items)
      && body.num_items >= 0
      ? Math.min(body.num_items, 1_000)
      : null,
    email: null,
    phone: null,
    consentGranted,
    testEventCode: null,
  });

  return NextResponse.json(result);
}
