/**
 * 자비스 AI 비서 API — Claude 기반 Router + 6개 Agent
 *
 * 아키텍처:
 *   1. Router Agent (Haiku) → 카테고리 판별
 *   2. 해당 Agent (Sonnet) → Tool 사용 + HITL
 *   3. 세션 히스토리 DB 저장
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifySupabaseAccessToken } from '@/lib/supabase-jwt-verify'
import { supabaseAdmin } from '@/lib/supabase'
import { routeMessage } from '@/lib/jarvis/claude-router'
import { runOperationsAgent } from '@/lib/jarvis/agents/operations'
import { runProductsAgent } from '@/lib/jarvis/agents/products'
import { runFinanceAgent } from '@/lib/jarvis/agents/finance'
import { runMarketingAgent } from '@/lib/jarvis/agents/marketing'
import { runSalesAgent } from '@/lib/jarvis/agents/sales'
import { runSystemAgent } from '@/lib/jarvis/agents/system'
import { resolveJarvisContext } from '@/lib/jarvis/context'
import type { JarvisContext } from '@/lib/jarvis/types'
import { resolveSpecialist, mergeOrchestrationContext } from '@/lib/jarvis/orchestration'
import { recordPlatformLearningEvent } from '@/lib/platform-learning'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message, sessionId, context = {} } = body

    if (!message?.trim()) {
      return NextResponse.json({ error: '메시지가 필요합니다.' }, { status: 400 })
    }

    const token = req.cookies.get('sb-access-token')?.value
    if (!token) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }
    const verified = await verifySupabaseAccessToken(token)
    if (!verified.ok) {
      return NextResponse.json({ error: '세션이 유효하지 않습니다.' }, { status: 401 })
    }

    const ctx: JarvisContext = resolveJarvisContext(req, body)

    // 1. 세션 가져오기 또는 생성
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

    // 2. Router로 Agent 결정
    const routerResult = await routeMessage(message, session?.context || {})
    const agentType = routerResult.agent
    const specialistPick = resolveSpecialist(agentType, message, ctx)

    // 3. 해당 Agent 실행
    const agentMap = {
      operations: runOperationsAgent,
      products:   runProductsAgent,
      finance:    runFinanceAgent,
      marketing:  runMarketingAgent,
      sales:      runSalesAgent,
      system:     runSystemAgent,
    } as const
    const runAgent = agentMap[agentType]
    const result = await runAgent({ message, session, user: null, ctx })

    // 4. 메시지 히스토리 업데이트
    const updatedMessages = [
      ...(session?.messages || []),
      { role: 'user', content: message, timestamp: new Date().toISOString() },
      {
        role: 'assistant',
        content: result.response,
        agent: agentType,
        toolsUsed: result.toolsUsed,
        pendingActionId: result.pendingActionId,
        timestamp: new Date().toISOString()
      }
    ]

    const mergedContext = {
      ...mergeOrchestrationContext(session?.context as Record<string, unknown> | undefined, specialistPick),
      ...result.contextUpdate,
    }

    await supabaseAdmin
      .from('jarvis_sessions')
      .update({
        messages: updatedMessages,
        context: mergedContext,
        updated_at: new Date().toISOString()
      })
      .eq('id', session.id)

    recordPlatformLearningEvent({
      source: 'jarvis_v1',
      sessionId: session.id,
      affiliateId: null,
      tenantId: ctx.tenantId ?? null,
      userMessage: message,
      payload: {
        agent: agentType,
        specialist_id: specialistPick.specialistId,
        specialist_method: specialistPick.method,
        tools_used: result.toolsUsed ?? [],
        pending_hitl: !!result.pendingActionId,
      },
    })

    return NextResponse.json({
      sessionId: session.id,
      agent: agentType,
      specialist: specialistPick,
      response: result.response,
      pendingAction: result.pendingAction,
      toolsUsed: result.toolsUsed,
    })

  } catch (error) {
    console.error('[자비스] 오류:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI 처리 실패' },
      { status: 500 }
    )
  }
}
