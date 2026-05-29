/**
 * 여소남 OS — QA Chat V2 (SSE Streaming, V2 Concierge Agent 기반)
 *
 * 기존 /api/qa/chat 의 NDJSON → SSE 변환, 단일 LLM 호출 → agent loop 교체.
 * V2 Concierge agent 를 사용하지만 QA Chat 특화 기능은 유지:
 *   - customer journey
 *   - fact memory (고객 정보 기억)
 *   - affiliate scope (제휴사 격리)
 *   - response critic (Self-RAG 검증)
 *   - free travel CTA
 *   - escalation
 *
 * 프로토콜: SSE (text/event-stream), 기존 ChatWidget.tsx 의 StreamEvent 와 호환.
 */

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getQaChatPackageContext } from '@/lib/qa-chat-packages'
import { buildQaPackageHintSource, extractQaDestinationHint } from '@/lib/qa-destination-hint'
import { extractAndStoreFacts, loadActiveFacts } from '@/lib/jarvis/fact-extractor'
import { critiqueReply, applyCritique } from '@/lib/jarvis/response-critic'
import { rateLimitAI } from '@/lib/rate-limiter'
import { resolveAffiliateScopeId } from '@/lib/affiliate-scope'
import { advanceCustomerJourney, type CustomerJourneySnapshot } from '@/lib/customer-journey'
import { recordPlatformLearningEvent } from '@/lib/platform-learning'
import { supervisorLite } from '@/lib/jarvis/supervisor-lite'
import { recordCritiqueResult } from '@/lib/response-learning'
import { startTraceSpan, endTraceSpan } from '@/lib/telemetry/agent-tracing'
import { createAgentTask, transitionAgentTask, createApprovalRequest } from '@/lib/agent/tasking'
import { requiresApproval } from '@/lib/jarvis/risk-scorer'
import { detectPromptInjection } from '@/lib/guardrails/prompt-injection'
import { getClientIpFromRequest } from '@/lib/simple-rate-limit'
import { resolveJarvisAuth } from '@/lib/jarvis/auth-resolver'
import { prepareDispatch, runV2 } from '@/lib/jarvis/v2-dispatch'
import { encodeSSE, SSE_HEADERS } from '@/lib/jarvis/stream-encoder'
import type { StreamEvent } from '@/lib/jarvis/stream-encoder'
import type { AgentRunResult } from '@/lib/jarvis/types'

export const runtime = 'nodejs'
export const maxDuration = 120

const COMMISSION_RATE = Number(process.env.DEFAULT_COMMISSION_RATE ?? 9)

function applyCommission(price: number) {
  return Math.round(price * (1 + COMMISSION_RATE / 100))
}

export async function POST(req: NextRequest) {
  const limited = await rateLimitAI(req)
  if (limited) return limited

  const body = await req.json()
  const {
    message,
    history = [],
    sessionId,
    referrer,
    affiliateRef,
    affiliateId: bodyAffiliateId,
  } = body
  const affiliateId = bodyAffiliateId ?? req.headers.get('x-affiliate-id') ?? undefined

  if (!message?.trim()) {
    return Response.json({ error: '메시지가 필요합니다.', code: 'MISSING_MESSAGE' }, { status: 400 })
  }

  const ip = getClientIpFromRequest(req)
  const rlKey = `qa_chat_v2:${ip}:${sessionId ?? 'anon'}`
  const { allowRateLimit } = await import('@/lib/simple-rate-limit')
  if (!allowRateLimit(rlKey, 25, 60_000)) {
    return Response.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' }, { status: 429 })
  }

  const correlationId = crypto.randomUUID()

  // ── 프롬프트 인젝션 감지 ──
  const injection = detectPromptInjection(message)
  if (injection.blocked) {
    return new Response(
      JSON.stringify({
        error: '요청이 보안 정책에 의해 차단되었습니다. 상담원 연결로 진행해 주세요.',
        escalate: true,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ── Jarvis 인증 (게스트 모드 지원) ──
  // QA Chat 은 공개 API — 인증 실패 시 V1 폴백을 위해 ctx 만 fallback 생성
  const auth = await resolveJarvisAuth(req, body)
  const ctx = auth.type === 'unauthenticated'
    ? { surface: 'customer' as const, tenantId: undefined, userId: undefined, userRole: 'customer' as const }
    : auth.ctx

  // ── SSE 스트림 ──
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emitSSE = (type: string, data: unknown) => {
        controller.enqueue(encodeSSE({ type, data } as StreamEvent))
      }
      const emitNDJSON = (ev: StreamEvent) => {
        // QA Chat 프론트엔드와 호환되는 이벤트 포맷 (NDJSON 과 SSE 모두 지원)
        controller.enqueue(encodeSSE(ev))
      }
      let agentTaskId: string | null = null
      let traceSpan: { id: string; started_at: string } | null = null
      const traceId = crypto.randomUUID()
      const started = Date.now()

      try {
        // ── 1. Supervisor 결정 ──
        const preDecision = supervisorLite({
          message,
          sessionId: sessionId ?? undefined,
          tenantId: ctx.tenantId ?? undefined,
          affiliateId: bodyAffiliateId ?? undefined,
          agentType: 'products', // 실제론 concierge 로 라우팅되지만 supervisor 식별용
          ctx: { ...ctx, surface: 'customer' },
          correlationId,
          source: 'qa_chat',
        })

        agentTaskId = await createAgentTask(preDecision.envelope).then(t => t.id)
        await transitionAgentTask(agentTaskId!, 'queued', 'running')
        traceSpan = await startTraceSpan({
          traceId,
          spanName: 'qa_chat_v2_total',
          sessionId: sessionId ?? null,
          taskId: agentTaskId!,
          agentType: preDecision.agentType,
          metadata: { specialistId: preDecision.specialistId },
        })

        // 고위험 = 승인 요청
        if (requiresApproval(preDecision.riskLevel)) {
          await transitionAgentTask(agentTaskId!, 'running', 'frozen', {
            last_error: 'approval_required_before_response',
          })
          await createApprovalRequest({
            taskId: agentTaskId!,
            reason: '고위험 고객요청으로 수동 승인 필요',
            requestedBy: 'system:qa-chat-v2',
            metadata: { riskLevel: preDecision.riskLevel, specialistId: preDecision.specialistId },
          })
          emitSSE('error', {
            message: '요청이 고위험으로 분류되어 관리자 승인 대기 상태로 전환되었습니다. 잠시 후 상담원이 이어서 안내드립니다.',
          })
          emitSSE('done', {})
          controller.close()
          return
        }

        // ── 2. 패키지 로드 (Destination hint 기반 선필터 → 전체 폴백) ──
        const qaHintSource = buildQaPackageHintSource(
          message,
          (history as { role: string; content: string }[]) ?? [],
        )
        const packages = await getQaChatPackageContext(qaHintSource)

        // ── 3. 대화 맥락 로드 ──
        let conversationCustomerId: string | null = null
        let existingAffiliateId: string | null = null
        let existingJourney: unknown = null
        if (sessionId) {
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
          affiliateId,
          affiliateRef,
          referrer,
          existingAffiliateId,
        })

        // ── 4. 고객 팩트 메모리 회수 ──
        const factTenantId = affiliateScopeId
        const memoryFacts = sessionId
          ? await loadActiveFacts(
              conversationCustomerId
                ? { customerId: conversationCustomerId, tenantId: factTenantId ?? null, limit: 15 }
                : { conversationId: sessionId, tenantId: factTenantId ?? null, limit: 15 },
            )
          : []

        const memoryContext = memoryFacts.length > 0
          ? `\n## 이 고객에 대해 기억하는 정보\n${memoryFacts.join('\n')}\n`
          : ''

        // ── 5. V2 Dispatch (concierge agent) ──
        // Jarvis V2 세션 생성
        let jarvisSession: any = null
        if (sessionId) {
          const { data } = await supabaseAdmin
            .from('jarvis_sessions')
            .select('*')
            .eq('id', sessionId)
            .single()
          jarvisSession = data
        }
        if (!jarvisSession) {
          const { data } = await supabaseAdmin
            .from('jarvis_sessions')
            .insert({
              id: sessionId ?? undefined,
              messages: [],
              context: { ...ctx, surface: 'customer', affiliateScopeId, factTenantId },
            })
            .select()
            .single()
          jarvisSession = data
        }

        const dispatch = await prepareDispatch({ message, session: jarvisSession, ctx })

        // V2 미지원 = V1 폴백 (기존 QA Chat 유지)
        if (!dispatch.supported || !dispatch.config) {
          emitSSE('agent_picked', {
            sessionId: jarvisSession.id,
            agent: dispatch.agentType,
            confidence: dispatch.routerConfidence,
            fallback: 'v1',
          })
          // V1 QA Chat 직접 호출 (HTTP 폴백 제거 — 내부 함수 직접 사용)
          const { createV1QaChatStream } = await import('@/lib/qa-chat-engine')
          const v1Stream = await createV1QaChatStream({
            message: body.message,
            history: body.history ?? [],
            sessionId: body.sessionId ?? null,
            referrer: body.referrer ?? null,
            affiliateRef: body.affiliateRef ?? null,
            affiliateId: (body.affiliateId as string | undefined) ?? null,
          })
          const v1Reader = v1Stream.getReader()
          const decoder = new TextDecoder()
          while (true) {
            const { value, done } = await v1Reader.read()
            if (done) break
            controller.enqueue(encoder.encode(decoder.decode(value)))
          }
          emitSSE('done', {})
          controller.close()
          return
        }

        // agent_picked 이벤트
        emitSSE('agent_picked', {
          sessionId: jarvisSession.id,
          agent: dispatch.agentType,
          confidence: dispatch.routerConfidence,
        })

        // ── 6. memory context 를 session context 에 주입 → agent 가 활용 ──
        const augmentedCtx = {
          ...ctx,
          surface: 'customer' as const,
          _qaMemoryContext: memoryContext,
          _qaPackageContext: packages.map((p: any) => ({
            id: p.id,
            title: p.title,
            destination: p.destination,
            duration: p.duration,
            price: p.price,
            inclusions: p.inclusions,
            itinerary: p.itinerary,
          })),
        }

        // ── 7. V2 실행 ──
        const generator = runV2(dispatch, {
          message,
          session: { ...jarvisSession, context: { ...jarvisSession.context, ...augmentedCtx } },
          ctx: augmentedCtx,
        }) as AsyncGenerator<StreamEvent, AgentRunResult>

        let finalResult: AgentRunResult | null = null
        let fullResponse = ''

        while (true) {
          const step = await generator.next()
          if (step.done) {
            finalResult = step.value ?? null
            break
          }
          const ev = step.value

          // text_delta → 프론트에 전달
          if (ev.type === 'text_delta') {
            const chunk = typeof ev.data === 'string' ? ev.data : ''
            fullResponse += chunk
            emitSSE('text', { content: chunk })
          } else if (ev.type === 'tool_use_start') {
            emitSSE('tool_use_start', ev.data)
          } else if (ev.type === 'tool_result') {
            emitSSE('tool_result', ev.data)
          } else if (ev.type === 'hitl_pending') {
            emitSSE('hitl_pending', ev.data)
          } else if (ev.type === 'error') {
            emitSSE('error', ev.data)
          }
        }

        // ── 8. Response Critic (Self-RAG 검증) ──
        const critique = await critiqueReply({
          userQuestion: message,
          packageContext: packages.length > 0
            ? packages.map((p: any) => `[${p.id}] ${p.title} ${p.destination} ${p.price ? p.price.toLocaleString() + '원' : ''}`).join('\n')
            : '',
          reply: fullResponse || finalResult?.response || '',
          recommendedPackageIds: [],
          validPackageIds: packages.map((p: any) => p.id),
        })
        const gated = applyCritique(
          fullResponse || finalResult?.response || '',
          false,
          critique,
        )

        const finalReply = gated.wasGated ? gated.reply : (fullResponse || finalResult?.response || '')

        // critique 결과 영속화
        void recordCritiqueResult({
          source: 'qa_chat',
          sessionId: sessionId ?? null,
          conversationId: sessionId ?? null,
          traceId,
          agentTaskId,
          affiliateId: affiliateScopeId ?? null,
          llmProvider: 'deepseek',
          llmModel: 'deepseek-v4-flash',
          severity: critique.severity,
          issues: critique.issues ?? [],
          userQuestion: message,
          reply: fullResponse || finalResult?.response || '',
          correctedReply: gated.wasGated ? finalReply : null,
          wasGated: gated.wasGated,
        })

        // ── 9. Customer Journey 업데이트 ──
        const journeySnapshot = advanceCustomerJourney(existingJourney, {
          userMessage: message,
          escalate: gated.escalate,
          recommendedPackageIds: [],
          critiqueSeverity: critique.severity,
          destinationHint: extractQaDestinationHint(qaHintSource),
        })

        // ── 10. 메타 이벤트 + done ──
        emitSSE('meta', {
          packages: [],
          escalate: gated.escalate,
          critiqueSeverity: critique.severity,
          journey: journeySnapshot,
          freeTravelHref: null,
        })
        emitSSE('done', {
          sessionId: jarvisSession.id,
          agent: dispatch.agentType,
          latencyMs: Date.now() - started,
        })

        // ── 11. Platform learning ──
        recordPlatformLearningEvent({
          source: 'qa_chat',
          sessionId: sessionId ?? null,
          affiliateId: affiliateScopeId ?? null,
          tenantId: ctx.tenantId ?? null,
          userMessage: message,
          payload: {
            journey: { stage: journeySnapshot.stage },
            escalate: gated.escalate,
            critiqueSeverity: critique.severity,
            llm_provider: 'deepseek',
            llm_model: 'deepseek-v4-flash',
            trace_id: traceId,
            tools_used: finalResult?.toolsUsed ?? [],
            v2_engine: true,
          },
        })

        // ── 12. 세션 히스토리 저장 ──
        if (sessionId) {
          const { data: existing } = await supabaseAdmin
            .from('conversations')
            .select('id, messages, affiliate_id')
            .eq('id', sessionId)
            .maybeSingle()

          const prevMessages = (existing?.messages as unknown as Array<{ role: string; content: string; timestamp: string }>) || []
          const updatedMessages: any[] = [
            ...prevMessages,
            { role: 'user', content: message, timestamp: new Date().toISOString() },
            {
              role: 'assistant',
              content: finalReply,
              timestamp: new Date().toISOString(),
              critiqueSeverity: critique.severity,
              agent: dispatch.agentType,
              toolsUsed: finalResult?.toolsUsed ?? [],
            },
          ]

          if (existing) {
            await supabaseAdmin
              .from('conversations')
              .update({
                messages: updatedMessages,
                updated_at: new Date().toISOString(),
                journey: journeySnapshot,
                ...(affiliateScopeId ? { affiliate_id: affiliateScopeId } : {}),
              })
              .eq('id', sessionId)
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
              })
          }

          // 팩트 메모리 저장 (fire-and-forget)
          if (finalReply) {
            const recentForExtraction = updatedMessages
              .filter((m: any) => m.type !== 'cta_links')
              .slice(-4)
              .map((m: any) => ({
                role: m.role,
                content: typeof m.content === 'string' ? m.content : '',
              }))
            extractAndStoreFacts({
              conversationId: sessionId,
              customerId: conversationCustomerId,
              tenantId: factTenantId,
              recentMessages: recentForExtraction,
              sourceMessageIdx: updatedMessages.length - 1,
            }).catch((e: unknown) => {
              console.warn('[qa-chat-v2] 사실 추출 실패 (무시):', e instanceof Error ? e.message : e);
            })
          }
        }

        // 태스크 완료
        if (agentTaskId) {
          await transitionAgentTask(agentTaskId, 'running', 'done', {
            completed_at: new Date().toISOString(),
          }).catch((e: unknown) => {
            console.warn('[qa-chat-v2] 태스크 완료 실패 (무시):', e instanceof Error ? e.message : e);
          })
        }
        if (traceSpan) {
          await endTraceSpan({
            id: traceSpan.id,
            startedAt: traceSpan.started_at,
            metadata: { traceId, totalLatencyMs: Date.now() - started },
          }).catch((e: unknown) => {
            console.warn('[qa-chat-v2] traceSpan 종료 실패 (무시):', e instanceof Error ? e.message : e);
          })
        }
      } catch (error) {
        console.error('[qa-chat-v2] 오류:', error)
        if (agentTaskId) {
          await transitionAgentTask(agentTaskId, 'running', 'failed', {
            last_error: error instanceof Error ? error.message : 'unknown',
          }).catch((e: unknown) => {
            console.warn('[qa-chat-v2] 태스크 실패 기록 실패 (무시):', e instanceof Error ? e.message : e);
          })
        }
        try {
          emitSSE('error', { message: error instanceof Error ? error.message : 'AI 처리 실패' })
          emitSSE('done', {})
        } catch (sseErr) {
          console.warn('[chat-v2] SSE emit 실패 (무시):', sseErr instanceof Error ? sseErr.message : String(sseErr));
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}

const encoder = new TextEncoder()
