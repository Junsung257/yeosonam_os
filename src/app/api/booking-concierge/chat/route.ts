import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getBookingPortalSessionFromRequest } from '@/lib/booking-portal-request-auth';
import { allowRateLimit, getClientIpFromRequest } from '@/lib/simple-rate-limit';
import { llmCall } from '@/lib/llm-gateway';
import { buildBookingConciergeSystemPrompt } from '@/lib/booking-concierge-prompt';
import { getSecret } from '@/lib/secret-registry';

function hasAnyLlmKey() {
  return Boolean(
    getSecret('DEEPSEEK_API_KEY')?.trim() ||
      getSecret('GEMINI_API_KEY')?.trim() ||
      getSecret('GOOGLE_AI_API_KEY')?.trim(),
  );
}

function buildHistorySnippet(
  rows: { role: string; content: string }[],
  maxPairs = 8,
): string {
  const tail = rows.slice(-maxPairs * 2);
  return tail
    .map((r) => `${r.role === 'user' ? '고객' : r.role === 'assistant' ? '컨시어지' : r.role}: ${r.content}`)
    .join('\n');
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '서버 설정 오류' }, { status: 503 });
  }

  const session = await getBookingPortalSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: '세션이 필요합니다.' }, { status: 401 });
  }

  const ip = getClientIpFromRequest(request);
  const rlKey = `bp_chat:${session.bookingId}:${ip}`;
  if (!allowRateLimit(rlKey, 24, 60_000)) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
  }

  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return NextResponse.json({ error: '메시지를 입력해 주세요.' }, { status: 400 });
  }
  if (message.length > 2_000) {
    return NextResponse.json({ error: '메시지가 너무 깁니다.' }, { status: 400 });
  }

  const { data: booking, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select(
      'booking_no, package_title, status, departure_date, total_price, paid_amount, deposit_amount, adult_count, child_count, concierge_ai_paused',
    )
    .eq('id', session.bookingId)
    .maybeSingle();

  if (bErr || !booking) {
    return NextResponse.json({ error: '예약을 찾을 수 없습니다.' }, { status: 404 });
  }

  const aiPaused = Boolean((booking as { concierge_ai_paused?: boolean }).concierge_ai_paused);

  const { error: uErr } = await supabaseAdmin.from('booking_concierge_messages').insert({
    booking_id: session.bookingId,
    role: 'user',
    content: message,
  } as never);

  if (uErr) {
    console.error('[booking-concierge/chat] user insert', uErr);
    return NextResponse.json(
      { error: '메시지 저장에 실패했습니다. DB 마이그레이션(booking_concierge_messages) 적용 여부를 확인해 주세요.' },
      { status: 500 },
    );
  }

  if (aiPaused) {
    return NextResponse.json({
      reply: null,
      aiPaused: true,
      humanHandoff: true,
    });
  }

  const { data: prior } = await supabaseAdmin
    .from('booking_concierge_messages')
    .select('role, content')
    .eq('booking_id', session.bookingId)
    .order('created_at', { ascending: true })
    .limit(80);

  const historyRows = (prior ?? []) as { role: string; content: string }[];
  const historyText = buildHistorySnippet(historyRows);

  let assistantText: string;
  let aiSkipped = false;

  if (!hasAnyLlmKey()) {
    aiSkipped = true;
    assistantText =
      'AI 답변 연동 전입니다. 급하신 문의는 카카오톡 채널로 연락 주시면 담당자가 확인 후 안내드립니다. (환불·취소·금액 확정은 상담을 통해 진행됩니다.)';
  } else {
    const sys = buildBookingConciergeSystemPrompt(booking as Record<string, unknown>);
    const userPrompt = historyText
      ? `아래 대화에서 가장 마지막 고객(user) 메시지에만 답하세요.\n\n${historyText}`
      : `고객 첫 메시지:\n${message}`;

    const result = await llmCall({
      task: 'jarvis-simple',
      systemPrompt: sys,
      userPrompt,
      maxTokens: 900,
      temperature: 0.35,
      autoEscalate: false,
    });

    if (!result.success || !(result.rawText ?? '').trim()) {
      assistantText =
        '지금은 AI 답변을 가져오지 못했습니다. 잠시 후 다시 시도하시거나 카카오톡 채널로 문의해 주세요.';
    } else {
      assistantText = (result.rawText ?? '').trim();
    }
  }

  const { error: aErr } = await supabaseAdmin.from('booking_concierge_messages').insert({
    booking_id: session.bookingId,
    role: 'assistant',
    content: assistantText,
    metadata: { aiSkipped } as never,
  } as never);

  if (aErr) {
    console.error('[booking-concierge/chat] assistant insert', aErr);
    return NextResponse.json({ error: '답변 저장에 실패했습니다.' }, { status: 500 });
  }

  return NextResponse.json({
    reply: assistantText,
    aiSkipped,
    aiPaused: false,
  });
}
