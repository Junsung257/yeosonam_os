import { NextRequest, NextResponse } from 'next/server';
import { getApprovedPackages, saveInquiry, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

const COMMISSION_RATE = Number(process.env.DEFAULT_COMMISSION_RATE ?? 9);

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

export async function POST(request: NextRequest) {
  try {
    const { message, history = [], sessionId, referrer } = await request.json();
    // referrer는 클라이언트에서 aff_ref 쿠키 값을 보내줌

    if (!message?.trim()) {
      return NextResponse.json({ error: '메시지가 필요합니다.' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI API 키가 설정되지 않았습니다.' }, { status: 500 });
    }

    // DB에서 승인된 패키지 로드
    let packages: any[] = [];
    if (isSupabaseConfigured) {
      packages = await getApprovedPackages();
    }

    // 패키지 컨텍스트 구성 (rawText 포함)
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

    // 대화 이력 구성
    const historyText = (history as {role: string; content: string}[])
      .slice(-6)
      .map(h => `${h.role === 'user' ? '고객' : '상담원'}: ${h.content}`)
      .join('\n');

    const systemPrompt = `당신은 여행사 AI 상담원입니다. 아래 상품 목록을 바탕으로 고객 문의에 답변하세요.

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

    const raw = await callGemini(apiKey, systemPrompt);

    // JSON 파싱
    let parsed: { reply: string; recommendedPackageIds: string[]; escalate: boolean };
    try {
      const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      // JSON 파싱 실패 시 raw 텍스트를 reply로
      parsed = { reply: raw, recommendedPackageIds: [], escalate: false };
    }

    // 추천 패키지 상세 정보
    const recommendedPackages = packages
      .filter(p => parsed.recommendedPackageIds?.includes(p.id))
      .map(p => ({
        id: p.id,
        title: p.title,
        destination: p.destination,
        duration: p.duration,
        price: p.price,
        sellingPrice: p.price ? applyCommission(p.price) : null,
        commissionRate: COMMISSION_RATE,
      }));

    // 에스컬레이션 시 DB에 저장
    if (parsed.escalate && isSupabaseConfigured) {
      await saveInquiry({
        question: message,
        inquiryType: 'escalation',
        relatedPackages: parsed.recommendedPackageIds ?? [],
      }).catch(err => console.warn('에스컬레이션 저장 실패:', err));
    }

    // ── conversations + intents DB 저장 (fire-and-forget) ──
    if (isSupabaseConfigured && sessionId) {
      (async () => {
        try {
          // conversations: upsert (ON CONFLICT → messages 업데이트)
          const { data: existing } = await supabaseAdmin
            .from('conversations')
            .select('id, messages')
            .eq('id', sessionId)
            .maybeSingle();

          const prevMessages = (existing?.messages as any[]) || [];
          const updatedMessages = [
            ...prevMessages,
            { role: 'user', content: message, timestamp: new Date().toISOString() },
            { role: 'assistant', content: parsed.reply, timestamp: new Date().toISOString() },
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

          // intents: 목적지/날짜/인원 키워드 감지 시 저장
          const destination = extractDestination(message);
          const hasDate = /\d+월|\d+일|다음달|이번달|주말|연휴/.test(message);
          const partyMatch = message.match(/(\d+)\s*명/);

          if (destination || hasDate || partyMatch) {
            await supabaseAdmin.from('intents').insert({
              conversation_id: sessionId,
              destination,
              party_size: partyMatch ? parseInt(partyMatch[1]) : null,
              booking_stage: parsed.escalate ? 'escalated' : 'browsing',
            });
          }
        } catch (e) {
          console.warn('[Chat] 대화 저장 실패 (무시):', e);
        }
      })();
    }

    return NextResponse.json({
      reply: parsed.reply,
      packages: recommendedPackages,
      escalate: parsed.escalate ?? false,
    });
  } catch (error) {
    console.error('[Chat API] 오류:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI 처리 실패' },
      { status: 500 }
    );
  }
}
