/**
 * 여소남 OS — Jarvis V2 Streaming SSE Endpoint
 *
 * 설계 근거: db/JARVIS_V2_DESIGN.md §B.1.4
 *
 * 동작:
 *   1) 요청에서 JarvisContext 추출 (tenant/user/role/surface)
 *   2) 세션 로드 또는 생성
 *   3) Router 실행 → agent type 결정
 *   4) V2 지원 agent 면 streaming, 아니면 400 반환 (클라이언트가 V1 엔드포인트로 폴백)
 *   5) AsyncGenerator 이벤트를 SSE 프레임으로 인코딩해서 흘림
 *   6) 종료 시 세션 히스토리 업데이트
 *
 * env 플래그:
 *   JARVIS_STREAM_ENABLED=false — 엔드포인트 자체 비활성화 (장애 시 긴급 스위치)
 */

import { NextRequest } from 'next/server'
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify'
import { supabaseAdmin } from '@/lib/supabase'
import { prepareDispatch, runV2 } from '@/lib/jarvis/v2-dispatch'
import { encodeSSE, encodeKeepalive, SSE_HEADERS } from '@/lib/jarvis/stream-encoder'
import { resolveJarvisContext } from '@/lib/jarvis/context'
import type { StreamEvent } from '@/lib/jarvis/stream-encoder'
import type { AgentRunResult } from '@/lib/jarvis/types'
import { mergeOrchestrationContext } from '@/lib/jarvis/orchestration'
import { recordPlatformLearningEvent } from '@/lib/platform-learning'
import { supervisorLite } from '@/lib/jarvis/supervisor-lite'
import { createAgentTask, transitionAgentTask } from '@/lib/agent/tasking'
import { startTraceSpan, endTraceSpan } from '@/lib/telemetry/agent-tracing'

export const runtime = 'nodejs'
export const maxDuration = 120 // DeepSeek V4-Pro 5라운드 최대 ~100초 + 마진

export async function POST(req: NextRequest) {
  if (process.env.JARVIS_STREAM_ENABLED === 'false') {
    return new Response(JSON.stringify({ error: 'streaming disabled' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: any
  try { body = await req.json() } catch { body = {} }
  const { message, sessionId, context = {} } = body

  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: '메시지가 필요합니다.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const token = req.cookies.get('sb-access-token')?.value
  if (!token) {
    return new Response(JSON.stringify({ error: '인증이 필요합니다.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const verified = await verifySupabaseAccessToken(token)
  if (!verified.ok) {
    return new Response(JSON.stringify({ error: '세션이 유효하지 않습니다.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const ctx = resolveJarvisContext(req, body)

  // 1) 세션 로드/생성 (V1 과 동일 스키마)
  let session: any = null
  if (sessionId) {
    const { data } = await supabaseAdmin
      .from('jarvis_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()
    session = data
  }
  if (!session) {
    const { data } = await supabaseAdmin
      .from('jarvis_sessions')
      .insert({ messages: [], context: { ...context, ...ctx } })
      .select()
      .single()
    session = data
  }

  // 2) Router + config 조립
  const dispatch = await prepareDispatch({ message, session, ctx })
  const traceId = crypto.randomUUID()
  const decision = supervisorLite({
    message,
    sessionId: session.id,
    tenantId: ctx.tenantId,
    affiliateId: null,
    agentType: dispatch.agentType,
    ctx,
    correlationId: crypto.randomUUID(),
    source: 'jarvis_stream',
  })
  const createdTask = await createAgentTask(decision.envelope)
  await transitionAgentTask(createdTask.id, 'queued', 'running')
  const rootSpan = await startTraceSpan({
    traceId,
    spanName: 'jarvis_stream_total',
    sessionId: session.id,
    taskId: createdTask.id,
    agentType: dispatch.agentType,
    metadata: { specialistId: dispatch.specialistPick.specialistId },
  })

  // V2 미지원 agent → 클라이언트가 V1 (/api/jarvis) 로 폴백하도록 명시 응답
  if (!dispatch.supported || !dispatch.config) {
    return new Response(
      JSON.stringify({
        fallback: 'v1',
        agentType: dispatch.agentType,
        sessionId: session.id,
        reason: 'agent not yet V2-enabled',
        specialist: dispatch.specialistPick,
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 3) SSE ReadableStream
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now()
      let finalResult: AgentRunResult | null = null
      let firstTokenAt: number | null = null
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null

      try {
        // 시작 이벤트 — agent 선택 결과
        controller.enqueue(encodeSSE({
          type: 'agent_picked',
          data: {
            sessionId: session.id,
            agent: dispatch.agentType,
            confidence: dispatch.routerConfidence,
            specialist: {
              id: dispatch.specialistPick.specialistId,
              label: dispatch.specialistPick.labelKo,
              method: dispatch.specialistPick.method,
            },
          },
        } as StreamEvent))

        // 15초마다 keepalive (Vercel/프록시 idle timeout 방어)
        keepaliveTimer = setInterval(() => {
          try { controller.enqueue(encodeKeepalive()) } catch { /* closed */ }
        }, 15_000)

        const generator = runV2(dispatch, { message, session, ctx }) as AsyncGenerator<StreamEvent, AgentRunResult>
        while (true) {
          const step = await generator.next()
          if (step.done) {
            finalResult = step.value
            break
          }
          if (firstTokenAt === null && (step.value as any)?.type === 'token') {
            firstTokenAt = Date.now()
          }
          controller.enqueue(encodeSSE(step.value))
        }

        // 4) 세션 히스토리 업데이트 (비동기로 빼지 않고 확정 후 종료 전에 기록)
        if (finalResult) {
          const updatedMessages = [
            ...(session?.messages ?? []),
            { role: 'user', content: message, timestamp: new Date().toISOString() },
            {
              role: 'assistant',
              content: finalResult.response,
              agent: dispatch.agentType,
              toolsUsed: finalResult.toolsUsed,
              pendingActionId: finalResult.pendingActionId,
              timestamp: new Date().toISOString(),
            },
          ]
          const orchBase = mergeOrchestrationContext(session?.context, dispatch.specialistPick)
          await supabaseAdmin
            .from('jarvis_sessions')
            .update({
              messages: updatedMessages,
              context: { ...orchBase, ...finalResult.contextUpdate },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id)

          recordPlatformLearningEvent({
            source: 'jarvis_v2_stream',
            sessionId: session.id,
            affiliateId: null,
            tenantId: ctx.tenantId ?? null,
            userMessage: message,
            payload: {
              agent: dispatch.agentType,
              specialist_id: dispatch.specialistPick.specialistId,
              specialist_method: dispatch.specialistPick.method,
              tools_used: finalResult?.toolsUsed ?? [],
              pending_hitl: !!finalResult?.pendingActionId,
              trace_id: traceId,
              ttft_ms: firstTokenAt ? firstTokenAt - started : null,
            },
          })
        }

        controller.enqueue(encodeSSE({
          type: 'done',
          data: {
            sessionId: session.id,
            agent: dispatch.agentType,
            specialist: dispatch.specialistPick,
            latencyMs: Date.now() - started,
            toolsUsed: finalResult?.toolsUsed ?? [],
            pendingAction: finalResult?.pendingAction ?? null,
          },
        }))
      } catch (err) {
        try {
          await transitionAgentTask(createdTask.id, 'running', 'failed', {
            last_error: err instanceof Error ? err.message : 'stream_error',
          })
        } catch {
          // ignore
        }
        console.error('[jarvis-stream] 오류:', err)
        controller.enqueue(encodeSSE({
          type: 'error',
          data: { message: err instanceof Error ? err.message : '스트리밍 오류' },
        }))
      } finally {
        if (finalResult) {
          try {
            await transitionAgentTask(createdTask.id, 'running', 'done', {
              completed_at: new Date().toISOString(),
            })
          } catch {
            // ignore
          }
        }
        try {
          await endTraceSpan({
            id: rootSpan.id,
            startedAt: rootSpan.started_at,
            metadata: {
              traceId,
              ttftMs: firstTokenAt ? firstTokenAt - started : null,
              totalLatencyMs: Date.now() - started,
            },
          })
        } catch {
          // ignore
        }
        if (keepaliveTimer) clearInterval(keepaliveTimer)
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
