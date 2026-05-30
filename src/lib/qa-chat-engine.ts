/**
 * 여소남 OS — QA Chat Engine (V1 엔진 공유)
 *
 * V1 QA Chat 의 NDJSON 스트림 생성 로직을 추출하여
 * V2 에서 HTTP 폴백 없이 직접 호출할 수 있게 한다.
 *
 * 사용:
 *   import { createV1QaChatStream } from '@/lib/qa-chat-engine'
 *   const stream = await createV1QaChatStream({ message, history, sessionId, ... })
 *   → ReadableStream<Uint8Array> (NDJSON)
 */

import type { NextRequest } from 'next/server'
import { supabaseAdmin, isSupabaseConfigured, saveInquiry } from '@/lib/supabase'
import { getPrompt } from '@/lib/prompt-loader'
import { getQaChatPackageContext } from '@/lib/qa-chat-packages'
import { buildQaPackageHintSource, extractQaDestinationHint } from '@/lib/qa-destination-hint'
import { extractAndStoreFacts, loadActiveFacts } from '@/lib/jarvis/fact-extractor'
import { critiqueReply } from '@/lib/jarvis/response-critic'
import { llmCall, tryDeepSeekStream } from '@/lib/llm-gateway'
import { resolveAffiliateScopeId } from '@/lib/affiliate-scope'
import { advanceCustomerJourney, type CustomerJourneySnapshot } from '@/lib/customer-journey'
import { recordPlatformLearningEvent } from '@/lib/platform-learning'
import { supervisorLite } from '@/lib/jarvis/supervisor-lite'
import {
  recordCritiqueResult,
  getRelevantCorrections,
  buildCorrectionsPromptFragment,
  getNegativeExamples,
  buildNegativePromptFragment,
} from '@/lib/response-learning'
import {
  createAgentTask,
  createApprovalRequest,
  transitionAgentTask,
  recordAgentIncident,
} from '@/lib/agent/tasking'
import { detectPromptInjection } from '@/lib/guardrails/prompt-injection'
import { requiresApproval } from '@/lib/jarvis/risk-scorer'
import { startTraceSpan, endTraceSpan } from '@/lib/telemetry/agent-tracing'
import { hasResilientLlmConfig } from '@/lib/secret-registry'
import { safeRawTextExcerpt } from '@/lib/raw-text-privacy'

const COMMISSION_RATE = Number(process.env.DEFAULT_COMMISSION_RATE ?? 9)
const QA_SYSTEM_FALLBACK = [
'당신은 ㈜여소남의 AI 컨시어지 소남이입니다.',
'',
'【★ 출력 포맷 — 반드시 아래 reply JSON 내 문자열 정확히 따라야 함】',
'',
'<reply-format>',
'다낭 패키지 알아보시는군요! 아래 인기 상품 추천드려요.',
'',
'---',
'**[에어부산 다낭/호이안 3박5일](/packages/997731d9)**',
'💰 740,110원 | 🏨 5성호텔 3박 | ✈️ 에어부산',
'> 💡 가성비 좋은 노팁옵션, 6월 특가 중 가장 저렴',
'',
'---',
'**[진에어 보홀 3박5일](/packages/83aebace)**',
'💰 543,910원 | 🏨 리조트 3박 | ✈️ 진에어',
'> 💡 돌핀왓칭+스노클링 포함, 가족여행에 딱',
'',
'위 2개 중 어떤 스타일이 더 끌리시나요?',
'</reply-format>',
'',
'【절대 금지】',
'- ❌ BX, LJ, KE, 7C 등 항공코드 그대로 사용',
'- ❌ "1️⃣", "##", "###", "## 1." 등 마크다운 제목/번호',
'- ❌ 상품 링크(/packages/ID) 누락',
'- ❌ "없습니다/없어요"로 종결',
'- ❌ "---" 구분선 없음',
'- ❌ 💰🏨✈️ 이모지 누락',
'- ❌ reply 12줄 초과',
'- ❌ 마지막이 질문 아님',
'',
'【항공코드 변환표】',
'BX→에어부산, LJ→진에어, KE→대한항공, OZ→아시아나항공, 7C→제주항공,',
'RS→에어서울, RF→이스타항공, ZE/TW→티웨이항공, VN→베트남항공, QH→뱀부에어웨이즈',
'',
'【운영 원칙】',
'1. 공감→인정→대안 (EAA): 감정 공감 후 2가지 이상 대안',
'2. 이유 있는 추천: 구체적 이유 필수 ("좋은 상품" 금지)',
'3. 손실회피 전환: 조건 불일치시 즉시 대안 전환, 절대 "없습니다" 종결 금지',
'4. 마지막 수단: "자유여행 맞춤 일정도 가능합니다"',
'5. 추천마다 반드시 /packages/ID 링크 포함',
'',
'【JSON 출력 형식】',
'{\n  "reply": "<reply-format>의 포맷 정확히 따를 것",\n  "recommendedPackageIds": ["ID1","ID2"],\n  "escalate": false,\n  "freeTravel": { "showCta": false, "dest": null, "month": null, "theme": null }\n}',
'',
'【출력 전 검증 — 3회 반복】',
'1. reply에 BX/LJ/KE/7C 항공코드 있음? → 변환',
'2. 모든 추천 상품에 /packages/ID 링크? → 추가',
'3. 상품마다 --- 구분선+이모지(💰🏨✈️)? → 수정',
'4. reply 12줄 이내? → 단축',
'5. 마지막 질문? 종결이 "없습니다/없어요"? → 수정',
'6. ## ### 1️⃣ 2️⃣ 같은 제목/번호? → 제거',
'',
'escalate: 특정날짜예약/10인이상단체/환불취소',
'freeTravel: 자유여행/맞춤일정/항공+호텔 원할 때 showCta=true',
].join("\n")

type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'text_final'; content: string }
  | { type: 'meta'; packages: unknown[]; escalate: boolean; critiqueSeverity: string; journey: unknown; freeTravelHref: string | null }
  | { type: 'error'; message: string }
  | { type: 'done' };

function encodeEvent(ev: StreamEvent, encoder: TextEncoder): Uint8Array {
  return encoder.encode(`${JSON.stringify(ev)}\n`);
}

const HANDOFF_REPLY =
  '요청하신 내용은 정확한 확인이 필요한 상담으로 분류되어 담당자가 이어서 도와드리겠습니다. 남겨주신 조건은 관리자 상담 큐에 전달해두었습니다.';

type QaPackageCard = {
  id: string
  title: string
  destination: string | null
  duration: number | null
  price: number | null
  sellingPrice: number | null
  commissionRate: number
}

function buildRecommendedPackageCards(packages: any[], ids: string[] | undefined): QaPackageCard[] {
  const validIds = new Set((ids ?? []).filter(Boolean))
  const picked = validIds.size > 0
    ? packages.filter((p) => validIds.has(p.id))
    : packages.slice(0, 3)

  return picked.slice(0, 3).map((p) => ({
    id: p.id,
    title: p.title,
    destination: p.destination ?? null,
    duration: p.duration ?? null,
    price: p.price ?? null,
    sellingPrice: p.price ? applyCommission(p.price) : null,
    commissionRate: COMMISSION_RATE,
  }))
}

function stripInvalidPackageLinks(reply: string, validIds: string[]): string {
  const valid = new Set(validIds);
  return reply
    .replace(/\[([^\]]+)\]\(\/packages\/([a-zA-Z0-9-]+)\)/g, (_match, label: string, id: string) => {
      return valid.has(id) ? `[${label}](/packages/${id})` : label;
    })
    .replace(/\/packages\/([a-zA-Z0-9-]+)/g, (match, id: string) => {
      return valid.has(id) ? match : '';
    })
    .replace(/[ \t]{2,}/g, ' ');
}

function scopePackagesToDestination(packages: any[], destinationHint: string | null): any[] {
  if (!destinationHint) return packages;
  return packages.filter((p) =>
    typeof p.destination === 'string' && p.destination.normalize('NFC').includes(destinationHint),
  );
}

function scopePackageIdsToDestination(packages: any[], destinationHint: string | null): string[] {
  return scopePackagesToDestination(packages, destinationHint)
    .map((p) => p.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

function inferQaDestinationHint(text: string): string | null {
  if (/\uB2E4\uB0AD|\uD638\uC774\uC548|\uB098\uD2B8\uB791|\uD558\uB178\uC774|\uD478\uAFB8\uC625|\uD638\uCE58\uBBFC|\uBCA0\uD2B8\uB0A8/.test(text)) return '\uB2E4\uB0AD'
  if (/\uBCF4\uD640|\uC138\uBD80|\uB9C8\uB2D0\uB77C|\uD544\uB9AC\uD540/.test(text)) return '\uBCF4\uD640'
  if (/\uC624\uC0AC\uCE74|\uAD50\uD1A0|\uD6C4\uCFE0\uC624\uCE74|\uB3C4\uCFC4|\uC0BF\uD3EC\uB85C|\uC77C\uBCF8/.test(text)) return '\uC624\uC0AC\uCE74'
  if (/\uACC4\uB9BC|\uC591\uC0AD|\uC911\uAD6D/.test(text)) return '\uACC4\uB9BC'
  return null
}

const FREE_TRAVEL_INTENT_RE =
  /자유여행|항공\s*\+\s*호텔|호텔\s*만|항공\s*만|일정\s*짜|견적\s*잡|마이리얼|직접\s*골라|패키지\s*말고|커스텀|맞춤\s*일정|비행기\s*만|숙소\s*만/i;

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

const SAFE_FREE_TRAVEL_INTENT_RE =
  /\uC790\uC720\uC5EC\uD589|\uD56D\uACF5\s*\+\s*\uD638\uD154|\uD638\uD154\s*\uB9CC|\uD56D\uACF5\s*\uB9CC|\uC77C\uC815\s*\uC9DC|\uACAC\uC801\s*\uC7A1|\uB9C8\uC774\uB9AC\uC5BC|\uC9C1\uC811\s*\uACE8\uB77C|\uD328\uD0A4\uC9C0\s*\uB9D0\uACE0|\uCEE4\uC2A4\uD140|\uB9DE\uCDA4\s*\uC77C\uC815|\uBE44\uD589\uAE30\s*\uB9CC|\uC219\uC18C\s*\uB9CC/i;

function extractSafeMonthFromText(text: string): string | null {
  const m = text.match(/(\d{1,2})\s*\uC6D4/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= 12) return String(n);
  return null;
}

function extractSafeThemeFromText(text: string): FreeTravelTheme | null {
  if (/\uBD80\uBAA8\uB2D8|\uD6A8\uB3C4/.test(text)) return 'parents';
  if (/\uAC00\uC871/.test(text)) return 'family';
  if (/\uCEE4\uD50C|\uD5C8\uB2C8\uBB38/.test(text)) return 'couple';
  return null;
}

function normalizeTheme(v: unknown): FreeTravelTheme | null {
  if (v === 'family' || v === 'parents' || v === 'couple') return v;
  return null;
}

function applyCommission(price: number) {
  return Math.round(price * (1 + COMMISSION_RATE / 100));
}

function buildFreeTravelHref(
  userMessage: string,
  llmFt?: { showCta?: boolean; dest?: string | null; month?: number | null; theme?: string | null },
): string | null {
  const intentFromLlm = llmFt?.showCta === true;
  const intentFromText = SAFE_FREE_TRAVEL_INTENT_RE.test(userMessage) || FREE_TRAVEL_INTENT_RE.test(userMessage);
  if (!intentFromLlm && !intentFromText) return null;
  const destRaw = (llmFt?.dest && String(llmFt.dest).trim()) || '';
  let monthStr: string | null = null;
  if (llmFt?.month != null && Number.isFinite(llmFt.month)) {
    const m = Math.round(Number(llmFt.month));
    if (m >= 1 && m <= 12) monthStr = String(m);
  }
  if (!monthStr) monthStr = extractSafeMonthFromText(userMessage) ?? extractMonthFromText(userMessage);
  let theme = normalizeTheme(llmFt?.theme);
  if (!theme) theme = extractSafeThemeFromText(userMessage) ?? extractThemeFromText(userMessage);
  const params = new URLSearchParams();
  if (destRaw) params.set('dest', destRaw);
  if (monthStr) params.set('month', monthStr);
  if (theme) params.set('theme', theme);
  const qs = params.toString();
  return qs ? `/free-travel?${qs}` : '/free-travel';
}

/** V1 QA Chat 의 NDJSON 스트림을 생성한다. V2 의 HTTP 폴백을 대체하는 내부 함수. */
export async function createV1QaChatStream(params: {
  message: string
  history?: { role: string; content: string }[]
  sessionId?: string | null
  referrer?: string | null
  affiliateRef?: string | null
  affiliateId?: string | null
  correlationId?: string
}): Promise<ReadableStream<Uint8Array>> {
  const {
    message,
    history = [],
    sessionId = null,
    referrer = null,
    affiliateRef = null,
    affiliateId: bodyAffiliateId = null,
    correlationId = crypto.randomUUID(),
  } = params

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let streamClosed = false
      const emit = (ev: StreamEvent) => {
        if (streamClosed) return
        try {
          controller.enqueue(encodeEvent(ev, encoder))
        } catch {
          streamClosed = true
        }
      }
      const closeStream = () => {
        if (streamClosed) return
        streamClosed = true
        try { controller.close() } catch { /* client may already have closed the stream */ }
      }
      let agentTaskId: string | null = null
      let traceSpan: { id: string; started_at: string } | null = null
      const traceId = crypto.randomUUID()

      try {
        const preDecision = supervisorLite({
          message,
          sessionId: sessionId ?? undefined,
          tenantId: undefined,
          affiliateId: bodyAffiliateId ?? undefined,
          agentType: 'products',
          ctx: { surface: 'customer' },
          correlationId,
          source: 'qa_chat',
        })

        if (isSupabaseConfigured) {
          const createdTask = await createAgentTask(preDecision.envelope)
          const taskId = createdTask.id
          agentTaskId = taskId
          await transitionAgentTask(taskId, 'queued', 'running')
          traceSpan = await startTraceSpan({
            traceId,
            spanName: 'qa_chat_total',
            sessionId: sessionId ?? undefined,
            taskId: agentTaskId ?? undefined,
            agentType: preDecision.agentType,
            metadata: { specialistId: preDecision.specialistId },
          })

          if (requiresApproval(preDecision.riskLevel)) {
            await transitionAgentTask(taskId, 'running', 'frozen', {
              last_error: 'approval_required_before_response',
            })
            await createApprovalRequest({
              taskId,
              reason: 'High-risk customer request requires human approval before response',
              requestedBy: 'system:qa-chat',
              metadata: { riskLevel: preDecision.riskLevel, specialistId: preDecision.specialistId },
            })
            emit({ type: 'text', content: HANDOFF_REPLY })
            emit({
              type: 'meta',
              packages: [],
              escalate: true,
              critiqueSeverity: 'handoff',
              journey: { stage: 'handoff', reason: 'risk_gate' },
              freeTravelHref: null,
            })
            emit({ type: 'done' })
            saveInquiry({
              question: message,
              inquiryType: 'escalation',
              relatedPackages: [],
            }).catch((err: unknown) => console.warn('risk handoff inquiry save failed:', err))
            closeStream()
            return
          }
        }

        const qaHintSource = buildQaPackageHintSource(
          message,
          (history as { role: string; content: string }[]) ?? [],
        )
        const destinationHint = extractQaDestinationHint(qaHintSource) ?? inferQaDestinationHint(qaHintSource)

        let packages: any[] = []
        if (isSupabaseConfigured) {
          packages = await getQaChatPackageContext(qaHintSource)
          packages = scopePackagesToDestination(packages, destinationHint)
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
상세내용: ${safeRawTextExcerpt(p.raw_text, 800) ?? ''}`
            ).join('\n\n---\n\n')
          : '현재 등록된 상품이 없습니다.'

        const historyText = (history as { role: string; content: string }[])
          .slice(-6)
          .map((h) => `${h.role === 'user' ? '고객' : '상담원'}: ${h.content}`)
          .join('\n')

        let conversationCustomerId: string | null = null
        let existingAffiliateId: string | null = null
        let existingJourney: unknown = null
        if (sessionId && isSupabaseConfigured) {
          const { data: conv } = await supabaseAdmin
            .from('conversations')
            .select('customer_id, affiliate_id, journey')
            .eq('id', sessionId)
            .maybeSingle()
          conversationCustomerId = (conv?.customer_id as string | null) ?? null
          existingAffiliateId = (conv?.affiliate_id as string | null) ?? null
          existingJourney = conv?.journey ?? null
        }

        const affiliateScopeId = await resolveAffiliateScopeId({
          affiliateId: bodyAffiliateId ?? undefined,
          affiliateRef,
          referrer,
          existingAffiliateId,
        })

        let affiliateContextText = ''
        if (affiliateScopeId && isSupabaseConfigured) {
          const { data: aff } = await supabaseAdmin
            .from('affiliates')
            .select('name, referral_code')
            .eq('id', affiliateScopeId)
            .maybeSingle()
          if (aff) {
            const a = aff as { name?: string | null; referral_code?: string | null }
            affiliateContextText = `\n## 제휴 유입 맥락\n고객은 ${a.name || '제휴 파트너'}님 링크(${a.referral_code || '-'})로 유입되었습니다. 답변 톤은 신뢰를 유지하고, 해당 파트너가 추천한 맥락을 존중하세요.\n`
          }
        }

        const factTenantId = affiliateScopeId

        const memoryFacts = sessionId && isSupabaseConfigured
          ? await loadActiveFacts(
              conversationCustomerId
                ? { customerId: conversationCustomerId, tenantId: factTenantId === null ? null : factTenantId, limit: 15 }
                : { conversationId: sessionId, tenantId: factTenantId === null ? null : factTenantId, limit: 15 },
            )
          : []
        const memoryContext = memoryFacts.length > 0
          ? `\n## 이 고객에 대해 기억하는 정보\n${memoryFacts.join('\n')}\n`
          : ''

        const [corrections, negExamples] = await Promise.all([
          getRelevantCorrections({
            source: 'qa_chat',
            destination: destinationHint,
            tenantId: affiliateScopeId,
            limit: 5,
          }),
          getNegativeExamples({ destination: destinationHint, limit: 3 }),
        ])
        const learningFragment =
          buildCorrectionsPromptFragment(corrections) +
          buildNegativePromptFragment(negExamples)

        const userPrompt = `${memoryContext}${affiliateContextText}${learningFragment}
## 상품 목록
${packageContext}

## 이전 대화
${historyText || '(첫 메시지)'}

## 고객 문의
${message}`

        const qaSystem = await getPrompt('qa-chat', QA_SYSTEM_FALLBACK)
        const llmCommon = {
          task: 'qa-chat' as const,
          systemPrompt: qaSystem,
          userPrompt,
          temperature: 0.2,
          maxTokens: 2500,
          autoEscalate: false,
          tenantId: affiliateScopeId,
        }
        let lastReplyStreamLen = 0
        let usedNonStreamFallback = packages.length === 0
        let gen = usedNonStreamFallback
          ? await llmCall(llmCommon)
          : await tryDeepSeekStream(
              llmCommon,
              ({ replyVisible }) => {
                if (!replyVisible || replyVisible.length <= lastReplyStreamLen) return
                emit({ type: 'text', content: replyVisible.slice(lastReplyStreamLen) })
                lastReplyStreamLen = replyVisible.length
              },
            )

        if (!gen.success || !gen.rawText?.trim()) {
          usedNonStreamFallback = true
          lastReplyStreamLen = 0
          gen = await llmCall(llmCommon)
        }

        if (!gen.success || !gen.rawText?.trim()) {
          const errMsg = gen.errors?.join('; ') || 'AI 응답 생성 실패'
          console.error('[Chat Engine] LLM 오류 상세:', { success: gen.success, rawTextLen: gen.rawText?.length, errors: gen.errors, provider: gen.provider, model: gen.model })
          throw new Error(errMsg)
        }

        const raw = gen.rawText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim()

        let parsed: {
          reply: string
          recommendedPackageIds: string[]
          escalate: boolean
          freeTravel?: { showCta?: boolean; dest?: string | null; month?: number | null; theme?: string | null }
        }
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = { reply: raw, recommendedPackageIds: [], escalate: false }
        }
        if (!parsed.freeTravel || typeof parsed.freeTravel !== 'object') {
          parsed.freeTravel = { showCta: false, dest: null, month: null, theme: null }
        }
        const scopedPackageIds = scopePackageIdsToDestination(packages, destinationHint)
        const scopedPackageIdSet = new Set(scopedPackageIds)
        parsed.recommendedPackageIds = (parsed.recommendedPackageIds ?? [])
          .filter((id) => scopedPackageIdSet.has(id))

        let freeTravelHref = buildFreeTravelHref(message, parsed.freeTravel)
        if (!freeTravelHref && destinationHint && packages.length === 0) {
          freeTravelHref = buildFreeTravelHref(message, {
            showCta: true,
            dest: destinationHint,
            month: null,
            theme: null,
          })
        }

        // ★ Critic은 참고용 로깅만 — 응답 차단 절대 안 함
        const critique = await critiqueReply({
          userQuestion: message,
          packageContext,
          reply: parsed.reply,
          recommendedPackageIds: parsed.recommendedPackageIds ?? [],
          validPackageIds: scopedPackageIds,
        })
        if (critique.severity !== 'ok') {
          console.warn(`[Critic] ${critique.severity}: ${critique.issues.join(' | ')}`)
        }

        // ★ 후처리: LLM 출력을 고객 친화적 포맷으로 강제 변환
        // (LLM이 프롬프트 규칙을 무시할 경우 안전장치)
        const effectiveCritiqueSeverity =
          critique.severity === 'block' && scopedPackageIds.length === 0 && freeTravelHref
            ? 'ok'
            : critique.severity
        let finalReply = parsed.reply
        const airlineNames: Record<string, string> = {
          BX:'에어부산', LJ:'진에어', KE:'대한항공', OZ:'아시아나항공',
          '7C':'제주항공', RS:'에어서울', RF:'이스타항공',
          ZE:'티웨이항공', TW:'티웨이항공', VN:'베트남항공', QH:'뱀부에어웨이즈',
        }
        // 1. 항공코드 → 풀네임 (모든 컨텍스트에서 확실히 변환)
        for (const [code, name] of Object.entries(airlineNames)) {
          for (let j = 0; j < 5; j++) {
            const before = finalReply
            finalReply = finalReply
              .replace(' ' + code + ' ', ' ' + name + ' ')
              .replace(' ' + code + ',', ' ' + name + ',')
              .replace(' ' + code + '.', ' ' + name + '.')
              .replace(' ' + code + '\n', ' ' + name + '\n')
              .replace(' ' + code + ')', ' ' + name + ')')
              .replace('[' + code + ']', name)
              .replace('[' + code + ' ', '[' + name + ' ')
              .replace(code + '\n', name + '\n')
              .replace('\n' + code + '\n', '\n' + name + '\n')
              .replace('\n' + code + ' ', '\n' + name + ' ')
              .replace(code + ']', name + ']')
            if (before === finalReply) break
          }
        }
        // 2. "에어부산7315" → "에어부산" (항공사명+숫자 정리)
        finalReply = finalReply.replace(/(에어부산|진에어|대한항공|아시아나|제주항공|에어서울|이스타|티웨이|베트남항공|뱀부에어웨이즈)\d+/g, '$1')
        // 3. 마크다운 제목 제거
        finalReply = finalReply.replace(/^#{1,6}\s+/gm, '')
        // 4. **굵게** → 일반 텍스트 (링크 내 **는 유지)
        finalReply = finalReply.replace(/\*\*(?!.*\]\()([^*]+)\*\*/g, '$1')
        // 5. 번호 정리
        finalReply = finalReply.replace(/^[\s👉🔥🌟💰]*\d+[️⃣.)\]]\s*/gm, '')
        finalReply = finalReply.replace(/^\*\*\d+[\.)]\s*/gm, '')
        finalReply = finalReply.replace(/^👉\s*/gm, '')
        // 6. 중복 개행 정리
        finalReply = finalReply.replace(/\n{3,}/g, '\n\n')
        // 7. reply에 /packages/ID 링크가 없으면 recommendedPackageIds로부터 추가
        const hasPkgLinks = /\/packages\/[a-zA-Z0-9-]+/.test(finalReply)
        if (!hasPkgLinks && parsed.recommendedPackageIds?.length > 0) {
          const linkStr = parsed.recommendedPackageIds.map((id:string) => `/packages/${id}`).join(', ')
          finalReply = finalReply.trimEnd() + `\n\n자세한 내용: ${linkStr}`
        }
        finalReply = stripInvalidPackageLinks(finalReply, scopedPackageIds)
        if (!/\/packages\/[a-zA-Z0-9-]+/.test(finalReply) && parsed.recommendedPackageIds?.length > 0) {
          const linkStr = parsed.recommendedPackageIds
            .filter((id: string) => scopedPackageIdSet.has(id))
            .map((id: string) => `/packages/${id}`)
            .join(', ')
          if (linkStr) finalReply = finalReply.trimEnd() + `\n\n자세한 상품 보기: ${linkStr}`
        }
        const suppressNoInventoryEscalation = scopedPackageIds.length === 0 && Boolean(freeTravelHref)
        const finalEscalate =
          ((parsed.escalate ?? false) && !suppressNoInventoryEscalation) ||
          effectiveCritiqueSeverity === 'block'

        // ★ Critic 수정본이 있으면 후처리된 버전에 추가 병합 (warn 수준만)
        if (effectiveCritiqueSeverity === 'warn' && critique.correctedReply) {
          finalReply = `💡 ${critique.correctedReply}\n\n---\n${finalReply}`
        }

        void recordCritiqueResult({
          source: 'qa_chat',
          sessionId: sessionId ?? null,
          conversationId: sessionId ?? null,
          traceId,
          agentTaskId,
          affiliateId: affiliateScopeId ?? null,
          llmProvider: gen.provider ?? null,
          llmModel: gen.model ?? null,
          severity: effectiveCritiqueSeverity,
          issues: critique.issues ?? [],
          userQuestion: message,
          reply: parsed.reply ?? '',
          correctedReply: finalReply,
          wasGated: false,
          metadata: {
            destination_hint: destinationHint ?? null,
            recommended_count: parsed.recommendedPackageIds?.length ?? 0,
            corrections_applied: corrections.length,
            negative_examples_applied: negExamples.length,
          },
        })

        const recommendedPackages = scopePackagesToDestination(
          buildRecommendedPackageCards(packages, parsed.recommendedPackageIds),
          destinationHint,
        )

        const journeyIds = parsed.recommendedPackageIds ?? []
        const journeySnapshot = advanceCustomerJourney(existingJourney, {
          userMessage: message,
          escalate: finalEscalate,
          recommendedPackageIds: journeyIds,
          critiqueSeverity: effectiveCritiqueSeverity,
          destinationHint,
        })

        if (usedNonStreamFallback) {
          emit({ type: 'text', content: finalReply })
        } else if (lastReplyStreamLen === 0) {
          emit({ type: 'text', content: finalReply })
        } else if (parsed.reply !== finalReply) {
          emit({ type: 'text_final', content: finalReply })
        }

        emit({
          type: 'meta',
          packages: recommendedPackages,
          escalate: finalEscalate,
          critiqueSeverity: effectiveCritiqueSeverity,
          journey: journeySnapshot,
          freeTravelHref,
        })
        emit({ type: 'done' })
        recordPlatformLearningEvent({
          source: 'qa_chat',
          sessionId: sessionId ?? null,
          affiliateId: affiliateScopeId ?? null,
          tenantId: null,
          userMessage: message,
          payload: {
            journey: { stage: journeySnapshot.stage },
            escalate: finalEscalate,
            critiqueSeverity: effectiveCritiqueSeverity,
            recommended_count: recommendedPackages.length,
            llm_provider: gen.provider,
            llm_model: gen.model,
            free_travel_cta: Boolean(freeTravelHref),
            trace_id: traceId,
          },
        })
        closeStream()

        if (agentTaskId && isSupabaseConfigured) {
          try {
            await transitionAgentTask(agentTaskId, 'running', 'done', { completed_at: new Date().toISOString() })
            if (traceSpan) {
              await endTraceSpan({ id: traceSpan.id, startedAt: traceSpan.started_at, metadata: { traceId } })
            }
          } catch { /* done 전이 실패는 사용자 응답과 무관 */ }
        }

        // Fire-and-forget 저장
        if (finalEscalate && isSupabaseConfigured) {
          saveInquiry({
            question: message,
            inquiryType: effectiveCritiqueSeverity === 'block' ? 'critic_blocked' : 'escalation',
            relatedPackages: parsed.recommendedPackageIds ?? [],
          }).catch((err: unknown) => console.warn('에스컬레이션 저장 실패:', err))
        }

        if (isSupabaseConfigured && sessionId) {
          ;(async () => {
            try {
              const { data: existing } = await supabaseAdmin
                .from('conversations')
                .select('id, messages, affiliate_id')
                .eq('id', sessionId)
                .maybeSingle()
              const prevMessages = (existing?.messages as unknown as Array<{ role: string; content: string; timestamp: string }>) || []
              const CTA_COPY = '항공·호텔을 직접 조합해 보고 싶다면 자유여행 AI 견적 페이지에서 이어가실 수 있어요.'
              const updatedMessages: any[] = [
                ...prevMessages,
                { role: 'user', content: message, timestamp: new Date().toISOString() },
                { role: 'assistant', content: finalReply, timestamp: new Date().toISOString(), critiqueSeverity: effectiveCritiqueSeverity },
              ]
              if (freeTravelHref) {
                updatedMessages.push({
                  role: 'assistant',
                  content: CTA_COPY,
                  type: 'cta_links',
                  ctaLinks: [{ label: '내 맞춤 자유여행 일정표 짜러가기', href: freeTravelHref }],
                  timestamp: new Date().toISOString(),
                })
              }
              const assistantFactSourceIdx = updatedMessages.length - (freeTravelHref ? 2 : 1)
              if (existing) {
                await supabaseAdmin
                  .from('conversations')
                  .update({ messages: updatedMessages, updated_at: new Date().toISOString(), journey: journeySnapshot, ...(affiliateScopeId ? { affiliate_id: affiliateScopeId } : {}) })
                  .eq('id', sessionId)
              } else {
                await supabaseAdmin
                  .from('conversations')
                  .insert({ id: sessionId, channel: 'web', source: referrer || 'chat_widget', messages: updatedMessages, affiliate_id: affiliateScopeId, journey: journeySnapshot })
              }
              const destination = extractQaDestinationHint(qaHintSource)
              const hasDate = /\d+월|\d+일|다음달|이번달|주말|연휴/.test(message)
              const partyMatch = message.match(/(\d+)\s*명/)
              if (destination || hasDate || partyMatch) {
                await supabaseAdmin.from('intents').insert({
                  conversation_id: sessionId,
                  destination,
                  party_size: partyMatch ? parseInt(partyMatch[1]) : null,
                  booking_stage: finalEscalate ? 'escalated' : 'browsing',
                })
              }
              const recentForExtraction = updatedMessages
                .filter((m: any) => m.type !== 'cta_links')
                .slice(-4)
                .map((m: any) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }))
              await extractAndStoreFacts({
                conversationId: sessionId,
                customerId: conversationCustomerId,
                tenantId: factTenantId,
                recentMessages: recentForExtraction,
                sourceMessageIdx: assistantFactSourceIdx,
              })
            } catch (e) {
              console.warn('[Chat] 대화 저장 실패 (무시):', e)
            }
          })()
        }
      } catch (error) {
        console.error('[Chat Engine] 오류:', error)
        if (agentTaskId && isSupabaseConfigured) {
          try {
            await transitionAgentTask(agentTaskId, 'running', 'failed', { last_error: error instanceof Error ? error.message : 'unknown' })
            if (traceSpan) {
              await endTraceSpan({ id: traceSpan.id, startedAt: traceSpan.started_at, metadata: { traceId, failed: true } })
            }
          } catch { /* ignore */ }
        }
        try {
          emit({ type: 'text', content: HANDOFF_REPLY })
          emit({
            type: 'meta',
            packages: [],
            escalate: true,
            critiqueSeverity: 'error',
            journey: { stage: 'handoff', reason: 'runtime_error' },
            freeTravelHref: null,
          })
          emit({ type: 'done' })
          if (isSupabaseConfigured) {
            saveInquiry({
              question: message,
              inquiryType: 'escalation',
              relatedPackages: [],
            }).catch((err: unknown) => console.warn('runtime handoff inquiry save failed:', err))
          }
        } catch { /* ignore */ }
        closeStream()
      }
    },
  })

  return stream
}
