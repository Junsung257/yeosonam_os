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
import { supabaseAdmin } from '@/lib/supabase'
import { prepareDispatch } from '@/lib/jarvis/v2-dispatch'
import { runGeminiAgentLoopV2 } from '@/lib/jarvis/gemini-agent-loop-v2'
import { encodeSSE, encodeKeepalive, SSE_HEADERS } from '@/lib/jarvis/stream-encoder'
import type { StreamEvent } from '@/lib/jarvis/stream-encoder'
import type { JarvisContext, AgentRunResult } from '@/lib/jarvis/types'

export const runtime = 'nodejs'
export const maxDuration = 60

function resolveCtx(req: NextRequest, body: any): JarvisContext {
  const h = req.headers
  const fromBody = (body?.context ?? {}) as Record<string, any>
  return {
    ...fromBody,
    tenantId: h.get('x-tenant-id') ?? fromBody.tenantId ?? undefined,
    userId: h.get('x-user-id') ?? fromBody.userId ?? undefined,
    userRole: (h.get('x-user-role') as JarvisContext['userRole']) ?? fromBody.userRole ?? undefined,
    surface: (h.get('x-surface') as JarvisContext['surface']) ?? fromBody.surface ?? 'admin',
  }
}

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

  const ctx = resolveCtx(req, body)

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

  // V2 미지원 agent → 클라이언트가 V1 (/api/jarvis) 로 폴백하도록 명시 응답
  if (!dispatch.supported || !dispatch.config) {
    return new Response(
      JSON.stringify({
        fallback: 'v1',
        agentType: dispatch.agentType,
        sessionId: session.id,
        reason: 'agent not yet V2-enabled',
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 3) SSE ReadableStream
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now()
      let finalResult: AgentRunResult | null = null
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null

      try {
        // 시작 이벤트 — agent 선택 결과
        controller.enqueue(encodeSSE({
          type: 'agent_picked',
          data: {
            sessionId: session.id,
            agent: dispatch.agentType,
            confidence: dispatch.routerConfidence,
          },
        } as StreamEvent))

        // 15초마다 keepalive (Vercel/프록시 idle timeout 방어)
        keepaliveTimer = setInterval(() => {
          try { controller.enqueue(encodeKeepalive()) } catch { /* closed */ }
        }, 15_000)

        const generator = runGeminiAgentLoopV2(dispatch.config!, { message, session, ctx })
        while (true) {
          const step = await generator.next()
          if (step.done) {
            finalResult = step.value
            break
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
          await supabaseAdmin
            .from('jarvis_sessions')
            .update({
              messages: updatedMessages,
              context: { ...(session?.context ?? {}), ...finalResult.contextUpdate },
              updated_at: new Date().toISOString(),
            })
            .eq('id', session.id)
        }

        controller.enqueue(encodeSSE({
          type: 'done',
          data: {
            sessionId: session.id,
            agent: dispatch.agentType,
            latencyMs: Date.now() - started,
            toolsUsed: finalResult?.toolsUsed ?? [],
            pendingAction: finalResult?.pendingAction ?? null,
          },
        }))
      } catch (err) {
        console.error('[jarvis-stream] 오류:', err)
        controller.enqueue(encodeSSE({
          type: 'error',
          data: { message: err instanceof Error ? err.message : '스트리밍 오류' },
        }))
      } finally {
        if (keepaliveTimer) clearInterval(keepaliveTimer)
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
