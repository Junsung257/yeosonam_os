import { NextRequest } from 'next/server';
import { saveInquiry, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { getQaChatPackageContext } from '@/lib/qa-chat-packages';
import { buildQaPackageHintSource, extractQaDestinationHint } from '@/lib/qa-destination-hint';
import { extractAndStoreFacts, loadActiveFacts } from '@/lib/jarvis/fact-extractor';
import { critiqueReply, applyCritique } from '@/lib/jarvis/response-critic';
import { llmCall } from '@/lib/llm-gateway';
import { resolveAffiliateScopeId } from '@/lib/affiliate-scope';
import { advanceCustomerJourney, type CustomerJourneySnapshot } from '@/lib/customer-journey';
import { recordPlatformLearningEvent } from '@/lib/platform-learning';

const COMMISSION_RATE = Number(process.env.DEFAULT_COMMISSION_RATE ?? 9);

// ── 스트림 청크 크기/딜레이 (타자기 효과) ─────────────
const CHUNK_SIZE = 6;        // 한글 ~6자 단위
const CHUNK_DELAY_MS = 12;   // 프레임 지연 (응답 체감 속도)

function extractMonthFromText(text: string): string | null {
  const m = text.match(/(\d{1,2})\s*월/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= 12) return String(n);
  return null;
}

type FreeTravelTheme = 'family' | 'parents' | 'couple';

function extractThemeFromText(text: string): FreeTravelTheme | null {
  if (/부모님|효도/.test(text)) return 'parents';
  if (/가족/.test(text)) return 'family';
  if (/커플|허니문/.test(text)) return 'couple';
  return null;
}

const FREE_TRAVEL_INTENT_RE =
  /자유여행|항공\s*\+\s*호텔|호텔\s*만|항공\s*만|일정\s*짜|견적\s*잡|마이리얼|직접\s*골라|패키지\s*말고|커스텀|맞춤\s*일정|비행기\s*만|숙소\s*만/i;

function normalizeTheme(v: unknown): FreeTravelTheme | null {
  if (v === 'family' || v === 'parents' || v === 'couple') return v;
  return null;
}

/** 서버·LLM 힌트를 합쳐 자유여행 페이지 링크 (의도 없으면 null) */
function buildFreeTravelHref(
  userMessage: string,
  llmFt?: { showCta?: boolean; dest?: string | null; month?: number | null; theme?: string | null },
): string | null {
  const intentFromLlm = llmFt?.showCta === true;
  const intentFromText = FREE_TRAVEL_INTENT_RE.test(userMessage);
  if (!intentFromLlm && !intentFromText) return null;

  const destRaw = (llmFt?.dest && String(llmFt.dest).trim()) || extractQaDestinationHint(userMessage) || '';
  let monthStr: string | null = null;
  if (llmFt?.month != null && Number.isFinite(llmFt.month)) {
    const m = Math.round(Number(llmFt.month));
    if (m >= 1 && m <= 12) monthStr = String(m);
  }
  if (!monthStr) monthStr = extractMonthFromText(userMessage);

  let theme = normalizeTheme(llmFt?.theme);
  if (!theme) theme = extractThemeFromText(userMessage);

  const params = new URLSearchParams();
  if (destRaw) params.set('dest', destRaw);
  if (monthStr) params.set('month', monthStr);
  if (theme) params.set('theme', theme);
  const qs = params.toString();
  return qs ? `/free-travel?${qs}` : '/free-travel';
}

function applyCommission(price: number) {
  return Math.round(price * (1 + COMMISSION_RATE / 100));
}

const QA_SYSTEM = `당신은 여행사 AI 상담원입니다. 아래 「상품 목록」「이전 대화」「고객 문의」를 바탕으로 답변하세요.

## 답변 규칙
1. 고객 요구에 맞는 상품을 1~3개 추천하고 이유를 설명하세요.
2. 판매가(커미션 포함)를 기준으로 가격을 안내하세요.
3. 다음 경우에는 escalate를 true로 설정하세요:
   - 특정 날짜 예약 가능 여부 확인
   - 10명 이상 단체 특별 견적
   - 환불/취소 정책 문의
   - DB에 적합한 상품이 전혀 없는 경우
4. 고객이 **자유여행·항공/호텔만 직접 구성·맞춤 일정·마이리얼트립 스타일 견적** 등을 원하면 reply에서 패키지와 병행 안내해도 되며, 이때 freeTravel.showCta를 true로 설정하세요. 목적지·월·동행(가족/부모님/커플)을 문장에서 추출해 freeTravel 필드에 채우세요. 순수 패키지만 원하면 showCta는 false.
5. 반드시 아래 JSON 형식으로만 답변하세요. 다른 텍스트 없이.

{
  "reply": "고객에게 보낼 답변 (마크다운 사용 가능)",
  "recommendedPackageIds": ["상품 ID 배열, 없으면 빈 배열"],
  "escalate": false,
  "freeTravel": {
    "showCta": false,
    "dest": null,
    "month": null,
    "theme": null
  }
}

freeTravel.theme은 "family" | "parents" | "couple" 중 하나 또는 null. dest는 한글 목적지명(예: 다낭). month는 1~12 정수 또는 null.`;

function hasAnyLlmKey() {
  return Boolean(
    process.env.DEEPSEEK_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_AI_API_KEY,
  );
}

// ── JSON-lines 스트림 프로토콜 ───────────────────────────
// 각 라인 = { type: 'text'|'meta'|'error'|'done', ... } + '\n'
type StreamEvent =
  | { type: 'text'; content: string }
  | {
      type: 'meta';
      packages: unknown[];
      escalate: boolean;
      critiqueSeverity: string;
      journey: CustomerJourneySnapshot;
      freeTravelHref: string | null;
    }
  | { type: 'error'; message: string }
  | { type: 'done' };

function encodeEvent(ev: StreamEvent, encoder: TextEncoder) {
  return encoder.encode(JSON.stringify(ev) + '\n');
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    message,
    history = [],
    sessionId,
    referrer,
    affiliateRef,
    affiliateId: bodyAffiliateId,
  } = body;
  const affiliateId = bodyAffiliateId ?? request.headers.get('x-affiliate-id') ?? undefined;

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: '메시지가 필요합니다.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!hasAnyLlmKey()) {
    return new Response(
      JSON.stringify({
        error: 'AI API 키가 설정되지 않았습니다. (DEEPSEEK_API_KEY 권장, 또는 GEMINI_API_KEY / GOOGLE_AI_API_KEY)',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (ev: StreamEvent) => controller.enqueue(encodeEvent(ev, encoder));

      try {
        const qaHintSource = buildQaPackageHintSource(
          message,
          (history as { role: string; content: string }[]) ?? [],
        );

        // DB에서 승인된 패키지 로드 (목적지 힌트 있으면 선필터 → 0건이면 전체 폴백)
        let packages: any[] = [];
        if (isSupabaseConfigured) {
          packages = await getQaChatPackageContext(qaHintSource);
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

        // ── 대화에 연결된 고객 + 제휴 스코프 (어필리에이터 = tenant_id / affiliate_id) ──
        let conversationCustomerId: string | null = null;
        let existingAffiliateId: string | null = null;
        let existingJourney: unknown = null;
        if (sessionId && isSupabaseConfigured) {
          const { data: conv } = await supabaseAdmin
            .from('conversations')
            .select('customer_id, affiliate_id, journey')
            .eq('id', sessionId)
            .maybeSingle();
          conversationCustomerId = (conv?.customer_id as string | null) ?? null;
          existingAffiliateId = (conv?.affiliate_id as string | null) ?? null;
          existingJourney = conv?.journey ?? null;
        }

        const affiliateScopeId = await resolveAffiliateScopeId({
          affiliateId,
          affiliateRef,
          referrer,
          existingAffiliateId,
        });

        const factTenantId = affiliateScopeId;

        // ── 고객 팩트 메모리 회수 — 제휴 스코프와 교차해 격리 (플랫폼은 tenant_id IS NULL) ──
        const memoryFacts = sessionId && isSupabaseConfigured
          ? await loadActiveFacts(
              conversationCustomerId
                ? {
                    customerId: conversationCustomerId,
                    tenantId: factTenantId === null ? null : factTenantId,
                    limit: 15,
                  }
                : {
                    conversationId: sessionId,
                    tenantId: factTenantId === null ? null : factTenantId,
                    limit: 15,
                  },
            )
          : [];
        const memoryContext = memoryFacts.length > 0
          ? `\n## 이 고객에 대해 기억하는 정보\n${memoryFacts.join('\n')}\n`
          : '';

        const userPrompt = `${memoryContext}
## 상품 목록
${packageContext}

## 이전 대화
${historyText || '(첫 메시지)'}

## 고객 문의
${message}`;

        // Phase 1: 전체 생성 (블로킹) — DeepSeek primary, Gemini fallback
        const gen = await llmCall({
          task: 'qa-chat',
          systemPrompt: QA_SYSTEM,
          userPrompt,
          temperature: 0.2,
          maxTokens: 2500,
          autoEscalate: false,
        });

        if (!gen.success || !gen.rawText?.trim()) {
          throw new Error(gen.errors?.join('; ') ?? 'AI 응답 생성 실패');
        }

        const raw = gen.rawText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();

        let parsed: {
          reply: string;
          recommendedPackageIds: string[];
          escalate: boolean;
          freeTravel?: { showCta?: boolean; dest?: string | null; month?: number | null; theme?: string | null };
        };
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = { reply: raw, recommendedPackageIds: [], escalate: false };
        }
        if (!parsed.freeTravel || typeof parsed.freeTravel !== 'object') {
          parsed.freeTravel = { showCta: false, dest: null, month: null, theme: null };
        }

        const freeTravelHref = buildFreeTravelHref(message, parsed.freeTravel);

        // Phase 2: Self-RAG 검증 (블로킹 — 환각 차단)
        const critique = await critiqueReply({
          userQuestion: message,
          packageContext,
          reply: parsed.reply,
          recommendedPackageIds: parsed.recommendedPackageIds ?? [],
          validPackageIds: packages.map((p) => p.id),
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

        const journeyIds =
          critique.severity === 'block' ? [] : (parsed.recommendedPackageIds ?? []);
        const journeySnapshot = advanceCustomerJourney(existingJourney, {
          userMessage: message,
          escalate: finalEscalate,
          recommendedPackageIds: journeyIds,
          critiqueSeverity: critique.severity,
          destinationHint: extractQaDestinationHint(qaHintSource),
        });

        // Phase 3: 승인된 텍스트를 타자기 효과로 스트림
        for (let i = 0; i < finalReply.length; i += CHUNK_SIZE) {
          const chunk = finalReply.slice(i, i + CHUNK_SIZE);
          emit({ type: 'text', content: chunk });
          if (i + CHUNK_SIZE < finalReply.length) {
            await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
          }
        }

        // Phase 4: 메타데이터 (packages + escalate + 고객 여정)
        emit({
          type: 'meta',
          packages: recommendedPackages,
          escalate: finalEscalate,
          critiqueSeverity: critique.severity,
          journey: journeySnapshot,
          freeTravelHref,
        });
        emit({ type: 'done' });
        recordPlatformLearningEvent({
          source: 'qa_chat',
          sessionId: sessionId ?? null,
          affiliateId: affiliateScopeId ?? null,
          tenantId: null,
          userMessage: message,
          payload: {
            journey: { stage: journeySnapshot.stage },
            escalate: finalEscalate,
            critiqueSeverity: critique.severity,
            recommended_count: recommendedPackages.length,
            llm_provider: gen.provider,
            llm_model: gen.model,
            free_travel_cta: Boolean(freeTravelHref),
          },
        });
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
                .select('id, messages, affiliate_id')
                .eq('id', sessionId)
                .maybeSingle();

              const prevMessages = (existing?.messages as any[]) || [];
              const CTA_COPY =
                '항공·호텔을 직접 조합해 보고 싶다면 자유여행 AI 견적 페이지에서 이어가실 수 있어요.';
              const updatedMessages: any[] = [
                ...prevMessages,
                { role: 'user', content: message, timestamp: new Date().toISOString() },
                {
                  role: 'assistant',
                  content: finalReply,
                  timestamp: new Date().toISOString(),
                  critiqueSeverity: critique.severity,
                },
              ];
              if (freeTravelHref) {
                updatedMessages.push({
                  role: 'assistant',
                  content: CTA_COPY,
                  type: 'cta_links',
                  ctaLinks: [{ label: '내 맞춤 자유여행 일정표 짜러가기', href: freeTravelHref }],
                  timestamp: new Date().toISOString(),
                });
              }
              const assistantFactSourceIdx = updatedMessages.length - (freeTravelHref ? 2 : 1);

              if (existing) {
                await supabaseAdmin
                  .from('conversations')
                  .update({
                    messages: updatedMessages,
                    updated_at: new Date().toISOString(),
                    journey: journeySnapshot,
                    ...(affiliateScopeId ? { affiliate_id: affiliateScopeId } : {}),
                  })
                  .eq('id', sessionId);
              } else {
                await supabaseAdmin
                  .from('conversations')
                  .insert({
                    id: sessionId,
                    channel: 'web',
                    source: referrer || 'chat_widget',
                    messages: updatedMessages,
                    affiliate_id: affiliateScopeId,
                    journey: journeySnapshot,
                  });
              }

              const destination = extractQaDestinationHint(qaHintSource);
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

              const recentForExtraction = updatedMessages
                .filter((m: any) => m.type !== 'cta_links')
                .slice(-4)
                .map((m: any) => ({
                  role: m.role,
                  content: typeof m.content === 'string' ? m.content : '',
                }));
              const result = await extractAndStoreFacts({
                conversationId: sessionId,
                customerId: conversationCustomerId,
                tenantId: factTenantId,
                recentMessages: recentForExtraction,
                sourceMessageIdx: assistantFactSourceIdx,
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
