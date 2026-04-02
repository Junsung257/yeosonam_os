// 자비스 Gemini 공유 Agentic Loop (HITL + fallback 포함)

import { supabaseAdmin } from '@/lib/supabase'
import { requiresHITL, getHITLInfo } from './hitl'
import { AgentType, AgentRunParams, AgentRunResult, PendingActionInfo } from './types'
import type { GeminiFunctionDeclaration } from './gemini-tool-format'

const MAX_ROUNDS = 10
const FALLBACK_MSG = '일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요.'

export interface GeminiAgentConfig {
  agentType: AgentType
  systemPrompt: string
  tools: GeminiFunctionDeclaration[]
  executeTool: (name: string, args: Record<string, any>) => Promise<any>
  contextExtractor?: (toolName: string, result: any) => Record<string, any>
}

export async function runGeminiAgentLoop(
  config: GeminiAgentConfig,
  params: AgentRunParams
): Promise<AgentRunResult> {
  const { agentType, systemPrompt, tools, executeTool, contextExtractor } = config
  const { message, session } = params

  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) {
    return { response: 'AI API 키가 설정되지 않았습니다.', toolsUsed: [], pendingAction: null, pendingActionId: null, contextUpdate: {} }
  }

  const model = process.env.JARVIS_AGENT_MODEL || 'gemini-2.5-pro'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const toolsUsed: string[] = []
  let pendingAction: PendingActionInfo | null = null
  let pendingActionId: string | null = null
  const contextUpdate: Record<string, any> = {}

  // session.messages → Gemini contents 변환
  const contents: any[] = [
    ...(session?.messages?.slice(-10) || []).map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ]

  let lastTextResponse = ''

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let json: any
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          tools: [{ function_declarations: tools }],
          contents,
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
      })

      if (!res.ok) {
        console.error(`[자비스] Gemini API ${res.status}:`, await res.text())
        return { response: FALLBACK_MSG, toolsUsed, pendingAction, pendingActionId, contextUpdate }
      }

      json = await res.json()
    } catch (err) {
      console.error('[자비스] Gemini fetch 오류:', err)
      return { response: FALLBACK_MSG, toolsUsed, pendingAction, pendingActionId, contextUpdate }
    }

    const candidate = json.candidates?.[0]
    if (!candidate?.content?.parts) {
      // 빈 응답 fallback
      return { response: lastTextResponse || FALLBACK_MSG, toolsUsed, pendingAction, pendingActionId, contextUpdate }
    }

    const parts = candidate.content.parts
    const funcCalls = parts.filter((p: any) => p.functionCall)

    // 텍스트 응답 (Tool 호출 없음) → 루프 종료
    if (funcCalls.length === 0) {
      const textPart = parts.find((p: any) => p.text)
      lastTextResponse = textPart?.text || '처리가 완료되었습니다.'
      break
    }

    // model 턴 기록
    contents.push({ role: 'model', parts })

    // Tool 실행
    const functionResponses: any[] = []

    for (const part of funcCalls) {
      const { name, args } = part.functionCall as { name: string; args: Record<string, any> }
      toolsUsed.push(name)

      // HITL 체크
      if (requiresHITL(name)) {
        const hitlInfo = getHITLInfo(name)!
        const { data: pending } = await supabaseAdmin
          .from('jarvis_pending_actions')
          .insert({
            session_id: session?.id,
            agent_type: agentType,
            tool_name: name,
            tool_args: args || {},
            description: hitlInfo.description,
            risk_level: hitlInfo.riskLevel,
          })
          .select()
          .single()

        pendingActionId = pending?.id
        pendingAction = {
          id: pending?.id,
          toolName: name,
          description: hitlInfo.description,
          riskLevel: hitlInfo.riskLevel,
          args: args || {},
        }
        lastTextResponse = `다음 작업을 실행하려고 합니다:\n\n**${hitlInfo.description}**\n\n승인하시겠습니까?`
        break
      }

      // 즉시 실행 (SELECT)
      let toolResult: any
      try {
        toolResult = await executeTool(name, args || {})

        // 컨텍스트 추출
        if (contextExtractor) {
          Object.assign(contextUpdate, contextExtractor(name, toolResult))
        }

        // Tool 로그
        await supabaseAdmin.from('jarvis_tool_logs').insert({
          session_id: session?.id,
          agent_type: agentType,
          tool_name: name,
          tool_args: args,
          result: toolResult,
          is_hitl: false,
        })
      } catch (err: any) {
        toolResult = {
          error: err.message,
          humanized: humanizeError(name, err.message),
        }
      }

      functionResponses.push({
        functionResponse: { name, response: { result: toolResult } },
      })
    }

    // HITL로 중단된 경우
    if (pendingAction) break

    // Tool 결과를 다음 턴에 전달
    contents.push({ role: 'user', parts: functionResponses })
  }

  return {
    response: lastTextResponse,
    toolsUsed,
    pendingAction,
    pendingActionId,
    contextUpdate,
  }
}

// ─── 에러 인간화 (gemini.ts에서 가져옴) ─────────────────────────────────────
function humanizeError(toolName: string, rawMsg: string): string {
  if (rawMsg.includes('duplicate key') || rawMsg.includes('already exists')) {
    return '이미 등록된 정보가 있어요. 중복 확인 후 다시 시도해 주세요.'
  }
  if (rawMsg.includes('violates foreign key') || rawMsg.includes('foreign key')) {
    return '연결된 정보를 찾을 수 없어요. 고객 또는 상품 정보를 먼저 확인해 주세요.'
  }
  if (rawMsg.includes('violates check constraint') || rawMsg.includes('check constraint')) {
    return '입력 값이 올바르지 않아요. 날짜나 금액 형식을 다시 확인해 주세요.'
  }
  if (rawMsg.includes('not found') || rawMsg.includes('찾을 수 없')) {
    return '해당 정보를 찾을 수 없어요. 이름이나 번호를 다시 확인해 주세요.'
  }
  if (toolName.includes('booking') || toolName.includes('customer')) {
    return '처리 중 잠깐 문제가 생겼어요. 다시 시도해 주시겠어요?'
  }
  if (toolName.includes('stats') || toolName.includes('finance') || toolName.includes('ledger')) {
    return '장부 조회 중 일시적인 문제가 발생했어요. 다시 시도해 주세요.'
  }
  return '일시적인 오류가 발생했어요. 잠시 후 다시 말씀해 주시면 처리해 드릴게요.'
}
