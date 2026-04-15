import { NextRequest } from 'next/server';
import { getApprovedPackages, saveInquiry, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { extractAndStoreFacts, loadActiveFacts } from '@/lib/jarvis/fact-extractor';
import { critiqueReply, applyCritique } from '@/lib/jarvis/response-critic';

const COMMISSION_RATE = Number(process.env.DEFAULT_COMMISSION_RATE ?? 9);

// ── 스트림 청크 크기/딜레이 (타자기 효과) ─────────────
const CHUNK_SIZE = 6;        // 한글 ~6자 단위
const CHUNK_DELAY_MS = 18;   // 프레임 지연

// ── 목적지 추출 헬퍼 ─────────────────────────────────────
const KNOWN_DESTINATIONS = [
  '다낭', '나트랑', '푸꾸옥', '하노이', '호치민',
  '오사카', '도쿄', '후쿠오카', '훗카이도', '교토', '시즈오카', '나고야',
  '방콕', '푸켓', '파타야', '치앙마이',
  '싱가포르', '홍콩', '마카오', '타이베이',
  '발리', '세부', '보라카이', '괌', '사이판',
  '파리', '런던', '로마', '바르셀로나', '프라하',
  '뉴욕', '하와이', '라스베가스', '시안', '장가계',
];

function extractDestination(text: string): string | null {
  for (const dest of KNOWN_DESTINATIONS) {
    if (text.includes(dest)) return dest;
  }
  return null;
}

function applyCommission(price: number) {
  return Math.round(price * (1 + COMMISSION_RATE / 100));
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API 오류 ${res.status}: ${err}`);
  }
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ── JSON-lines 스트림 프로토콜 ───────────────────────────
// 각 라인 = { type: 'text'|'meta'|'error'|'done', ... } + '\n'
type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'meta'; packages: unknown[]; escalate: boolean; critiqueSeverity: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

function encodeEvent(ev: StreamEvent, encoder: TextEncoder) {
  return encoder.encode(JSON.stringify(ev) + '\n');
}

export async function POST(request: NextRequest) {
  const { message, history = [], sessionId, referrer } = await request.json();

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: '메시지가 필요합니다.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'AI API 키가 설정되지 않았습니다.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (ev: StreamEvent) => controller.enqueue(encodeEvent(ev, encoder));

      try {
        // DB에서 승인된 패키지 로드
        let packages: any[] = [];
        if (isSupabaseConfigured) {
          packages = await getApprovedPackages();
        }

        const packageContext = packages.length > 0
          ? packages.map((p, i) =>
              `[상품${i + 1}] ID:${p.id}
상품명: ${p.title}
목적지: ${p.destination ?? '미지정'}
기간: ${p.duration ? p.duration + '일' : '미지정'}
기본가: ${p.price ? p.price.toLocaleString() + '원' : '미지정'} / 판매가(커미션${COMMISSION_RATE}% 포함): ${p.price ? applyCommission(p.price).toLocaleString() + '원' : '미지정'}
포함사항: ${(p.inclusions ?? []).join(', ') || '없음'}
불포함: ${(p.excludes ?? []).join(', ') || '없음'}
일정: ${(p.itinerary ?? []).join(' | ') || '없음'}
상세내용: ${(p.raw_text ?? '').slice(0, 800)}`
            ).join('\n\n---\n\n')
          : '현재 등록된 상품이 없습니다.';

        const historyText = (history as { role: string; content: string }[])
          .slice(-6)
          .map((h) => `${h.role === 'user' ? '고객' : '상담원'}: ${h.content}`)
          .join('\n');

        // ── 대화에 연결된 고객 식별 (P4.5 — 리드 제출 후 백필된 customer_id) ──
        let conversationCustomerId: string | null = null;
        if (sessionId && isSupabaseConfigured) {
          const { data: conv } = await supabaseAdmin
            .from('conversations')
            .select('customer_id')
            .eq('id', sessionId)
            .maybeSingle();
          conversationCustomerId = (conv?.customer_id as string | null) ?? null;
        }

        // ── 고객 팩트 메모리 회수 — customer_id 있으면 크로스 세션 회수, 없으면 세션 스코프 ──
        const memoryFacts = sessionId && isSupabaseConfigured
          ? await loadActiveFacts(
              conversationCustomerId
                ? { customerId: conversationCustomerId, limit: 15 }
                : { conversationId: sessionId, limit: 15 },
            )
          : [];
        const memoryContext = memoryFacts.length > 0
          ? `\n## 이 고객에 대해 기억하는 정보\n${memoryFacts.join('\n')}\n`
          : '';

        const systemPrompt = `당신은 여행사 AI 상담원입니다. 아래 상품 목록을 바탕으로 고객 문의에 답변하세요.
${memoryContext}
## 상품 목록
${packageContext}

## 답변 규칙
1. 고객 요구에 맞는 상품을 1~3개 추천하고 이유를 설명하세요.
2. 판매가(커미션 포함)를 기준으로 가격을 안내하세요.
3. 다음 경우에는 escalate를 true로 설정하세요:
   - 특정 날짜 예약 가능 여부 확인
   - 10명 이상 단체 특별 견적
   - 환불/취소 정책 문의
   - DB에 적합한 상품이 전혀 없는 경우
4. 반드시 아래 JSON 형식으로만 답변하세요. 다른 텍스트 없이.

{
  "reply": "고객에게 보낼 답변 (마크다운 사용 가능)",
  "recommendedPackageIds": ["상품 ID 배열, 없으면 빈 배열"],
  "escalate": false
}

## 이전 대화
${historyText || '(첫 메시지)'}

## 고객 문의
${message}`;

        // Phase 1: 전체 생성 (블로킹)
        const raw = await callGemini(apiKey, systemPrompt);

        let parsed: { reply: string; recommendedPackageIds: string[]; escalate: boolean };
        try {
          const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
          parsed = JSON.parse(jsonStr);
        } catch {
          parsed = { reply: raw, recommendedPackageIds: [], escalate: false };
        }

        // Phase 2: Self-RAG 검증 (블로킹 — 환각 차단)
        const critique = await critiqueReply({
          userQuestion: message,
          packageContext,
          reply: parsed.reply,
          recommendedPackageIds: parsed.recommendedPackageIds ?? [],
          validPackageIds: packages.map((p) => p.id),
          apiKey,
        });
        const gated = applyCritique(parsed.reply, parsed.escalate ?? false, critique);
        if (gated.wasGated) {
          console.warn(`[Critic] ${critique.severity}: ${critique.issues.join(' | ')}`);
        }
        const finalReply = gated.reply;
        const finalEscalate = gated.escalate;

        const recommendedPackages = critique.severity === 'block'
          ? []
          : packages
              .filter((p) => parsed.recommendedPackageIds?.includes(p.id))
              .map((p) => ({
                id: p.id,
                title: p.title,
                destination: p.destination,
                duration: p.duration,
                price: p.price,
                sellingPrice: p.price ? applyCommission(p.price) : null,
                commissionRate: COMMISSION_RATE,
              }));

        // Phase 3: 승인된 텍스트를 타자기 효과로 스트림
        for (let i = 0; i < finalReply.length; i += CHUNK_SIZE) {
          const chunk = finalReply.slice(i, i + CHUNK_SIZE);
          emit({ type: 'text', content: chunk });
          if (i + CHUNK_SIZE < finalReply.length) {
            await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
          }
        }

        // Phase 4: 메타데이터 (packages + escalate)
        emit({
          type: 'meta',
          packages: recommendedPackages,
          escalate: finalEscalate,
          critiqueSeverity: critique.severity,
        });
        emit({ type: 'done' });
        controller.close();

        // ── Fire-and-forget: 에스컬레이션/대화/팩트 저장 ──
        if (finalEscalate && isSupabaseConfigured) {
          saveInquiry({
            question: message,
            inquiryType: critique.severity === 'block' ? 'critic_blocked' : 'escalation',
            relatedPackages: parsed.recommendedPackageIds ?? [],
          }).catch((err) => console.warn('에스컬레이션 저장 실패:', err));
        }

        if (isSupabaseConfigured && sessionId) {
          (async () => {
            try {
              const { data: existing } = await supabaseAdmin
                .from('conversations')
                .select('id, messages')
                .eq('id', sessionId)
                .maybeSingle();

              const prevMessages = (existing?.messages as any[]) || [];
              const updatedMessages = [
                ...prevMessages,
                { role: 'user', content: message, timestamp: new Date().toISOString() },
                { role: 'assistant', content: finalReply, timestamp: new Date().toISOString(), critiqueSeverity: critique.severity },
              ];

              if (existing) {
                await supabaseAdmin
                  .from('conversations')
                  .update({ messages: updatedMessages, updated_at: new Date().toISOString() })
                  .eq('id', sessionId);
              } else {
                await supabaseAdmin
                  .from('conversations')
                  .insert({
                    id: sessionId,
                    channel: 'web',
                    source: referrer || 'chat_widget',
                    messages: updatedMessages,
                  });
              }

              const destination = extractDestination(message);
              const hasDate = /\d+월|\d+일|다음달|이번달|주말|연휴/.test(message);
              const partyMatch = message.match(/(\d+)\s*명/);

              if (destination || hasDate || partyMatch) {
                await supabaseAdmin.from('intents').insert({
                  conversation_id: sessionId,
                  destination,
                  party_size: partyMatch ? parseInt(partyMatch[1]) : null,
                  booking_stage: finalEscalate ? 'escalated' : 'browsing',
                });
              }

              const recentForExtraction = updatedMessages.slice(-4).map((m: any) => ({
                role: m.role,
                content: m.content,
              }));
              const result = await extractAndStoreFacts({
                conversationId: sessionId,
                customerId: conversationCustomerId,
                tenantId: null,
                recentMessages: recentForExtraction,
                apiKey,
                sourceMessageIdx: updatedMessages.length - 1,
              });
              if (result.added + result.updated > 0) {
                console.log(`[FactExtractor] 세션 ${sessionId.slice(0, 8)}: +${result.added} /u ${result.updated} /noop ${result.noop}`);
              }
            } catch (e) {
              console.warn('[Chat] 대화 저장 실패 (무시):', e);
            }
          })();
        }
      } catch (error) {
        console.error('[Chat API] 오류:', error);
        try {
          emit({ type: 'error', message: error instanceof Error ? error.message : 'AI 처리 실패' });
          emit({ type: 'done' });
        } catch {}
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
