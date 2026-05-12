import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { redactKoreanPII } from '@/lib/pii-redactor';
import { parseKakaoChat, summarizeForExtraction } from '@/lib/kakao-chat-parser';
import { extractKtkg, normalizeEntityKey, hashSnippet } from '@/lib/ktkg-extractor';
import { extractPassengers } from '@/lib/passenger-extractor';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface IngestBody {
  raw_text: string;
  source?: string;
  tenant_id?: string;
  consent_for_pool?: boolean;
  conversation_id?: string;
  related_booking_id?: string;
  preview_only?: boolean;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  let body: IngestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  if (!body.raw_text || typeof body.raw_text !== 'string' || body.raw_text.trim().length < 10) {
    return NextResponse.json({ error: 'raw_text 가 너무 짧음 (최소 10자)' }, { status: 400 });
  }

  // 1. 파싱 + PII 제거 (동기)
  const messages = parseKakaoChat(body.raw_text);
  const conversationForLLM = summarizeForExtraction(messages);
  const { redacted, report } = redactKoreanPII(conversationForLLM);

  // 2. KTKG(Sonnet) + 일행 추출(Haiku) 병렬 실행 → 총 소요시간 = max(둘 중 긴 쪽)
  let extraction;
  let passengerResult;
  try {
    [extraction, passengerResult] = await Promise.all([
      extractKtkg({ redactedConversation: redacted, label: 'kakao-ingest' }),
      extractPassengers(conversationForLLM).catch(() => ({ passengers: [], total_pax_note: null })),
    ]);
  } catch (e) {
    return NextResponse.json({
      error: 'KTKG 추출 실패',
      detail: e instanceof Error ? e.message : String(e),
      preview: { messages, redacted_text: redacted, redaction_report: report },
      passenger_candidates: [],
    }, { status: 500 });
  }

  if (body.preview_only) {
    return NextResponse.json({
      preview: true,
      messages,
      redacted_text: redacted,
      redaction_report: report,
      extraction,
      passenger_candidates: passengerResult.passengers,
      total_pax_note: passengerResult.total_pax_note,
    });
  }

  const redactedRaw = redactKoreanPII(body.raw_text);

  const { data: bronzeRow, error: bronzeErr } = await supabaseAdmin
    .from('bronze_chat_events')
    .insert({
      tenant_id: body.tenant_id ?? null,
      source: body.source ?? 'kakao_paste',
      conversation_id: body.conversation_id ?? null,
      raw_payload: {
        raw_text: redactedRaw.redacted,
        parsed_messages: messages,
        pasted_at: new Date().toISOString(),
      },
      redacted_text: redacted,
      redaction_report: report,
      consent_for_pool: body.consent_for_pool ?? true,
      related_booking_id: body.related_booking_id ?? null,
      message_count: messages.length,
      extraction_status: 'extracted',
      extracted_at: new Date().toISOString(),
      triple_count: extraction.triples.length,
      metadata: {
        booking_draft: extraction.booking_draft,
        detected_demographic: extraction.detected_demographic,
        conversation_phase: extraction.conversation_phase,
        summary: extraction.summary,
      },
    })
    .select('id')
    .single();

  if (bronzeErr || !bronzeRow) {
    return NextResponse.json({
      error: 'Bronze 적재 실패',
      detail: bronzeErr?.message,
    }, { status: 500 });
  }

  const bronzeEventId = (bronzeRow as { id: string }).id;

  if (extraction.triples.length > 0) {
    const tripleRows = extraction.triples.map(t => ({
      bronze_event_id: bronzeEventId,
      tenant_id: body.tenant_id ?? null,
      entity_name: t.entity_name,
      entity_type: t.entity_type,
      entity_norm: normalizeEntityKey(t.entity_name),
      aspect: t.aspect,
      sentiment_score: t.sentiment_score,
      sentiment_label: t.sentiment_label,
      demographic: t.demographic,
      phase: t.phase,
      snippet: t.snippet,
      confidence: t.confidence,
      source_message_idx: t.source_message_idx,
      raw_quote_hash: hashSnippet(t.snippet),
    }));

    const { error: tripleErr } = await supabaseAdmin.from('ktkg_triples').insert(tripleRows);
    if (tripleErr) {
      return NextResponse.json({
        error: 'KTKG triple 적재 실패 (Bronze 는 적재됨)',
        bronze_event_id: bronzeEventId,
        detail: tripleErr.message,
      }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    bronze_event_id: bronzeEventId,
    message_count: messages.length,
    triple_count: extraction.triples.length,
    redaction_report: report,
    booking_draft: extraction.booking_draft,
    detected_demographic: extraction.detected_demographic,
    conversation_phase: extraction.conversation_phase,
    summary: extraction.summary,
    triples: extraction.triples,
    passenger_candidates: passengerResult.passengers,
    total_pax_note: passengerResult.total_pax_note,
  });
}
