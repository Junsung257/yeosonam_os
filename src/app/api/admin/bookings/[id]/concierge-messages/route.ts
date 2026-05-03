import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, resolveAdminActorLabel } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { allowRateLimit, getClientIpFromRequest } from '@/lib/simple-rate-limit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const { id: bookingId } = await params;
  if (!bookingId) {
    return NextResponse.json({ error: '예약 ID가 필요합니다.' }, { status: 400 });
  }

  const { data: booking, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select('id, concierge_ai_paused')
    .eq('id', bookingId)
    .maybeSingle();
  if (bErr || !booking) {
    return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
  }

  const aiPaused = Boolean((booking as { concierge_ai_paused?: boolean }).concierge_ai_paused);

  const { data, error } = await supabaseAdmin
    .from('booking_concierge_messages')
    .select('id, role, content, metadata, created_at')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true })
    .limit(400);

  if (error) {
    console.error('[admin/concierge-messages GET]', error);
    return NextResponse.json(
      { error: '메시지를 불러오지 못했습니다. booking_concierge_messages 마이그레이션을 확인하세요.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ messages: data ?? [], aiPaused });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const { id: bookingId } = await params;
  if (!bookingId) {
    return NextResponse.json({ error: '예약 ID가 필요합니다.' }, { status: 400 });
  }

  let body: { aiPaused?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  if (typeof body.aiPaused !== 'boolean') {
    return NextResponse.json({ error: 'aiPaused(boolean)가 필요합니다.' }, { status: 400 });
  }

  const { data: row, error: uErr } = await supabaseAdmin
    .from('bookings')
    .update({ concierge_ai_paused: body.aiPaused } as never)
    .eq('id', bookingId)
    .select('id, concierge_ai_paused')
    .maybeSingle();

  if (uErr || !row) {
    console.error('[admin/concierge-messages PATCH]', uErr);
    return NextResponse.json({ error: '갱신에 실패했습니다. 컬럼(concierge_ai_paused) 마이그레이션을 확인하세요.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    aiPaused: Boolean((row as { concierge_ai_paused?: boolean }).concierge_ai_paused),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const { id: bookingId } = await params;
  if (!bookingId) {
    return NextResponse.json({ error: '예약 ID가 필요합니다.' }, { status: 400 });
  }

  const ip = getClientIpFromRequest(request);
  if (!allowRateLimit(`admin_concierge_post:${bookingId}:${ip}`, 40, 60_000)) {
    return NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return NextResponse.json({ error: '내용을 입력해 주세요.' }, { status: 400 });
  }
  if (content.length > 4_000) {
    return NextResponse.json({ error: '내용이 너무 깁니다.' }, { status: 400 });
  }

  const { data: booking, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select('id')
    .eq('id', bookingId)
    .maybeSingle();
  if (bErr || !booking) {
    return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
  }

  const actor = await resolveAdminActorLabel(request);

  const { error: insErr } = await supabaseAdmin.from('booking_concierge_messages').insert({
    booking_id: bookingId,
    role: 'staff',
    content,
    metadata: { by: actor } as never,
  } as never);

  if (insErr) {
    console.error('[admin/concierge-messages POST]', insErr);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
