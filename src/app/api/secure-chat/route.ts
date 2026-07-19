import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import {
  isSupabaseConfigured,
  createSecureChat,
  getSecureChats,
  unmaskChatsForBooking,
} from '@/lib/supabase';
import { filterMessage } from '@/lib/chat-filter';
import { SENSITIVE_API_NO_STORE_HEADERS, sensitiveBackendUnavailable } from '@/lib/sensitive-api-fail-closed';

const NO_STORE_HEADERS = SENSITIVE_API_NO_STORE_HEADERS;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const bookingId = searchParams.get('bookingId') ?? undefined;
  const rfqId = searchParams.get('rfqId') ?? undefined;
  const viewAs = (searchParams.get('viewAs') ?? 'customer') as
    'customer' | 'land_agency' | 'admin';

  if (!bookingId && !rfqId) {
    return apiResponse(
      { error: 'bookingId 또는 rfqId 가 필요합니다' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('secure_chat');
  }

  const chats = await getSecureChats({ bookingId, rfqId, receiverType: viewAs });
  const result = chats.map((c) => ({
    ...c,
    message: viewAs === 'admin'
      ? c.raw_message
      : c.is_unmasked
        ? c.raw_message
        : c.masked_message,
  }));

  return apiResponse({ chats: result, count: result.length }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('secure_chat');
  }

  let body: {
    booking_id?: string;
    rfq_id?: string;
    sender_type: 'customer' | 'land_agency' | 'system';
    sender_id: string;
    receiver_type: 'customer' | 'land_agency' | 'admin';
    message: string;
  };

  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }

  const { booking_id, rfq_id, sender_type, sender_id, receiver_type, message } = body;

  if (!sender_id || !sender_type || !receiver_type || !message) {
    return apiResponse(
      { error: 'sender_id, sender_type, receiver_type, message 필수입니다' },
      { status: 400 },
    );
  }
  if (!booking_id && !rfq_id) {
    return apiResponse({ error: 'booking_id 또는 rfq_id 가 필요합니다' }, { status: 400 });
  }

  const { maskedMessage, isFiltered, detectedTypes } = filterMessage(message);

  const chat = await createSecureChat({
    booking_id: booking_id ?? null,
    rfq_id: rfq_id ?? null,
    sender_type,
    sender_id,
    receiver_type,
    raw_message: message,
    masked_message: maskedMessage,
    is_filtered: isFiltered,
    filter_detail: isFiltered ? detectedTypes.join(', ') : null,
    is_unmasked: false,
  });

  if (!chat) {
    return apiResponse({ error: '저장 실패' }, { status: 500 });
  }

  return apiResponse({
    id: chat.id,
    message: maskedMessage,
    is_filtered: isFiltered,
    detected_types: detectedTypes,
  }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return sensitiveBackendUnavailable('secure_chat');
  }

  let body: { booking_id: string };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.booking_id) {
    return apiResponse({ error: 'booking_id 가 필요합니다' }, { status: 400 });
  }

  await unmaskChatsForBooking(body.booking_id);
  return apiResponse({ ok: true, booking_id: body.booking_id });
}
