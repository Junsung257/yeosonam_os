import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import {
  isSupabaseConfigured,
  createSecureChat,
  getSecureChats,
  unmaskChatsForBooking,
  type SecureChat,
} from '@/lib/supabase';
import { filterMessage, resolveMessage } from '@/lib/chat-filter';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

const MOCK_CHATS: SecureChat[] = [
  {
    id: 'chat-mock-1',
    rfq_id: 'rfq-mock-1',
    sender_type: 'customer',
    sender_id: 'customer-1',
    receiver_type: 'land_agency',
    raw_message: '안녕하세요. 일정 중 자유 시간은 얼마나 있나요?',
    masked_message: '안녕하세요. 일정 중 자유 시간은 얼마나 있나요?',
    is_filtered: false,
    is_unmasked: false,
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'chat-mock-2',
    rfq_id: 'rfq-mock-1',
    sender_type: 'land_agency',
    sender_id: 'tenant-1',
    receiver_type: 'customer',
    raw_message: '안녕하세요 고객님. 매일 오후 2시간 자유 시간이 있습니다.',
    masked_message: '안녕하세요 고객님. 매일 오후 2시간 자유 시간이 있습니다.',
    is_filtered: false,
    is_unmasked: false,
    created_at: new Date(Date.now() - 1800000).toISOString(),
  },
];

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
    const visible = MOCK_CHATS.filter((c) =>
      viewAs === 'admin' ? true : c.receiver_type === viewAs,
    ).map((c) => ({
      ...c,
      message: viewAs === 'admin'
        ? c.raw_message
        : resolveMessage(c.raw_message, c.masked_message, 'DRAFT'),
    }));
    return apiResponse({ chats: visible, mock: true }, { headers: NO_STORE_HEADERS });
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

  if (!isSupabaseConfigured) {
    return apiResponse({
      id: `mock-${Date.now()}`,
      message: maskedMessage,
      is_filtered: isFiltered,
      detected_types: detectedTypes,
      mock: true,
    }, { status: 201 });
  }

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
  let body: { booking_id: string };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.booking_id) {
    return apiResponse({ error: 'booking_id 가 필요합니다' }, { status: 400 });
  }

  if (!isSupabaseConfigured) {
    return apiResponse({ ok: true, unmasked: 0, mock: true });
  }

  await unmaskChatsForBooking(body.booking_id);
  return apiResponse({ ok: true, booking_id: body.booking_id });
}
