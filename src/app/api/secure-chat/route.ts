import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  createSecureChat,
  getSecureChats,
  unmaskChatsForBooking,
  type SecureChat,
} from '@/lib/supabase';
import { filterMessage, resolveMessage } from '@/lib/chat-filter';

// ── Mock 데이터 ───────────────────────────────────────────────

const MOCK_CHATS: SecureChat[] = [
  {
    id: 'chat-mock-1',
    rfq_id: 'rfq-mock-1',
    sender_type: 'customer',
    sender_id: 'customer-1',
    receiver_type: 'land_agency',
    raw_message: '안녕하세요! 일정 중 자유 시간이 얼마나 되나요?',
    masked_message: '안녕하세요! 일정 중 자유 시간이 얼마나 되나요?',
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

// ── GET /api/secure-chat?bookingId=...&rfqId=...&viewAs=... ────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const bookingId = searchParams.get('bookingId') ?? undefined;
  const rfqId     = searchParams.get('rfqId') ?? undefined;
  const viewAs    = (searchParams.get('viewAs') ?? 'customer') as
    'customer' | 'land_agency' | 'admin';

  if (!bookingId && !rfqId) {
    return NextResponse.json({ error: 'bookingId 또는 rfqId 가 필요합니다' }, { status: 400 });
  }

  if (!isSupabaseConfigured) {
    // Mock: booking 상태를 DRAFT로 간주 → 마스킹 적용
    const visible = MOCK_CHATS.filter((c) =>
      viewAs === 'admin' ? true : c.receiver_type === viewAs
    ).map((c) => ({
      ...c,
      // 어드민은 raw_message 노출, 나머지는 masked_message
      message: viewAs === 'admin'
        ? c.raw_message
        : resolveMessage(c.raw_message, c.masked_message, 'DRAFT'),
    }));
    return NextResponse.json({ chats: visible, mock: true });
  }

  const chats = await getSecureChats({ bookingId, rfqId, receiverType: viewAs });

  // 어드민은 원본, 그 외는 결제 상태에 따라 마스킹 해제 여부 결정
  // 여기서는 booking 상태 조회를 생략하고 is_unmasked 플래그로 판단
  const result = chats.map((c) => ({
    ...c,
    message: viewAs === 'admin'
      ? c.raw_message
      : c.is_unmasked
        ? c.raw_message
        : c.masked_message,
  }));

  return NextResponse.json({ chats: result, count: result.length });
}

// ── POST /api/secure-chat ─────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
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
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { booking_id, rfq_id, sender_type, sender_id, receiver_type, message } = body;

  if (!sender_id || !sender_type || !receiver_type || !message) {
    return NextResponse.json(
      { error: 'sender_id, sender_type, receiver_type, message 는 필수입니다' },
      { status: 400 }
    );
  }
  if (!booking_id && !rfq_id) {
    return NextResponse.json({ error: 'booking_id 또는 rfq_id 가 필요합니다' }, { status: 400 });
  }

  // ── PII 필터링 ─────────────────────────────────────────────
  const { maskedMessage, isFiltered, detectedTypes } = filterMessage(message);

  if (!isSupabaseConfigured) {
    return NextResponse.json({
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
    return NextResponse.json({ error: '저장 실패' }, { status: 500 });
  }

  return NextResponse.json({
    id: chat.id,
    message: maskedMessage,        // 발신자에게 반환되는 메시지 (마스킹본)
    is_filtered: isFiltered,
    detected_types: detectedTypes,
  }, { status: 201 });
}

// ── PATCH /api/secure-chat/unmask — 결제 완료 후 마스킹 해제 ─

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  let body: { booking_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.booking_id) {
    return NextResponse.json({ error: 'booking_id 가 필요합니다' }, { status: 400 });
  }

  // 실제 운영: booking 테이블에서 status=COMPLETED 확인 필요
  // 여기서는 요청 자체를 신뢰 (내부 API, 결제 webhook에서 호출)

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: true, unmasked: 0, mock: true });
  }

  await unmaskChatsForBooking(body.booking_id);
  return NextResponse.json({ ok: true, booking_id: body.booking_id });
}
