import { type NextRequest, NextResponse } from 'next/server';
import { sendMetaConversion, type MetaStandardEvent } from '@/lib/meta-conversions';

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
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!eventAllowed((body as { event_name?: unknown }).event_name)) {
    return NextResponse.json({ error: 'Unsupported event_name' }, { status: 400 });
  }

  const eventId = typeof (body as { event_id?: unknown }).event_id === 'string'
    ? (body as { event_id: string }).event_id
    : crypto.randomUUID();

  const consentGranted = request.cookies.get('ys_marketing_consent')?.value === 'true';
  const result = await sendMetaConversion({
    eventName: (body as { event_name: MetaStandardEvent }).event_name,
    eventId,
    eventSourceUrl: typeof body.event_source_url === 'string' ? body.event_source_url : request.headers.get('referer'),
    actionSource: 'website',
    productId: typeof body.product_id === 'string' ? body.product_id : null,
    bookingId: typeof body.booking_id === 'string' ? body.booking_id : null,
    sessionId: request.cookies.get('ys_session_id')?.value ?? null,
    fbp: request.cookies.get('_fbp')?.value ?? null,
    fbc: request.cookies.get('_fbc')?.value ?? null,
    clientIpAddress: readClientIp(request),
    clientUserAgent: request.headers.get('user-agent'),
    value: typeof body.value === 'number' ? body.value : null,
    currency: typeof body.currency === 'string' ? body.currency : 'KRW',
    contentName: typeof body.content_name === 'string' ? body.content_name : null,
    contentCategory: typeof body.content_category === 'string' ? body.content_category : null,
    contentIds: arrayOfStrings(body.content_ids),
    contentType: typeof body.content_type === 'string' ? body.content_type : null,
    numItems: typeof body.num_items === 'number' ? body.num_items : null,
    email: typeof body.email === 'string' ? body.email : null,
    phone: typeof body.phone === 'string' ? body.phone : null,
    consentGranted,
    testEventCode: typeof body.test_event_code === 'string' ? body.test_event_code : null,
  });

  return NextResponse.json(result);
}
