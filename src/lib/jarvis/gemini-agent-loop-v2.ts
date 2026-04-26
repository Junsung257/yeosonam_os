/**
 * 여소남 OS — Gemini Agent Loop V2 (streaming + context caching + parallel tools)
 *
 * 설계 근거: db/JARVIS_V2_DESIGN.md §B.1
 *
 * V1 대비 차이점:
 * 1. streamGenerateContent (SSE) 로 토큰 단위 delta 수신 → 첫 토큰 1~3초
 * 2. cachedContents 로 system prompt + tool schema 5분 캐시 (토큰 비용 75% 감소)
 * 3. Gemini 2.5 의 parallel function calling 활용 — 여러 tool 호출을 Promise.all 로 동시 실행
 * 4. AsyncGenerator 로 이벤트 스트림 yield (라우트에서 SSE 로 그대로 통과)
 * 5. MAX_ROUNDS = 5 (V1 기본 10에서 축소, env JARVIS_V2_MAX_ROUNDS 로 조정)
 * 6. 라운드 초과 시 친근한 에스컬레이션 메시지
 */

import { supabaseAdmin } from '@/lib/supabase'
import { requiresHITL, getHITLInfo } from './hitl'
import { getOrCreateCache } from './gemini-cache-manager'
import { buildTenantSystemPrompt, isAgentAllowed } from './persona'
import { trackCost, assertQuota, QuotaExceededError } from './cost-tracker'
import type { StreamEvent } from './stream-encoder'
import type { AgentType, AgentRunResult, JarvisContext, PendingActionInfo } from './types'
import type { GeminiFunctionDeclaration } from './gemini-tool-format'

const MAX_ROUNDS_V2 = Number.parseInt(process.env.JARVIS_V2_MAX_ROUNDS ?? '5', 10)
const HISTORY_TURNS_V2 = Number.parseInt(process.env.JARVIS_V2_HISTORY_TURNS ?? '5', 10)
const FALLBACK_MSG = '일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요.'
const ESCALATE_MSG = '요청이 조금 복잡하네요. 담당자에게 확인 후 정확히 안내드릴게요.'

export interface GeminiAgentV2Config {
  agentType: AgentType
  systemPrompt: string
  tools: GeminiFunctionDeclaration[]
  executeTool: (name: string, args: Record<string, any>, ctx: JarvisContext) => Promise<any>
  contextExtractor?: (toolName: string, result: any) => Record<string, any>
  model?: string // default 'gemini-2.5-pro'
  maxRounds?: number
}

export interface V2RunParams {
  message: string
  session: any
  ctx: JarvisContext
}

/**
 * AsyncGenerator — SSE 엔드포인트가 yield 되는 이벤트를 그대로 통과시킨다.
 * 마지막에 return 으로 최종 AgentRunResult 를 돌려주므로 라우트에서 수거 가능.
 */
export async function* runGeminiAgentLoopV2(
  config: GeminiAgentV2Config,
  params: V2RunParams,
): AsyncGenerator<StreamEvent, AgentRunResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) {
    yield { type: 'error', data: { reason: 'no_api_key', message: FALLBACK_MSG } }
    return emptyResult(FALLBACK_MSG)
  }

  const model = config.model ?? process.env.JARVIS_V2_AGENT_MODEL ?? 'gemini-2.5-pro'
  const maxRounds = config.maxRounds ?? MAX_ROUNDS_V2
  const startedAt = Date.now()
  const totalUsage = { promptTokenCount: 0, candidatesTokenCount: 0, cachedContentTokenCount: 0, thoughtsTokenCount: 0 }

  // 0-a) 쿼터 체크 — 초과 시 즉시 중단
  try {
    await assertQuota(params.ctx)
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      yield { type: 'error', data: { reason: 'quota_exceeded', message: err.message } }
      return emptyResult('이번 달 사용량 한도에 도달했어요. 관리자에게 문의해 주세요.')
    }
    throw err
  }

  // 0-b) Agent 권한 체크 — 테넌트 프로파일의 allowed_agents 에 없으면 거부
  if (!(await isAgentAllowed(params.ctx, config.agentType))) {
    yield { type: 'error', data: { reason: 'agent_not_allowed' } }
    return emptyResult('이 기능은 현재 사용 권한이 없어요. 관리자에게 문의해 주세요.')
  }

  // 0-c) 테넌트 페르소나·가드레일을 base prompt 에 append
  const tenantAwarePrompt = await buildTenantSystemPrompt(config.systemPrompt, params.ctx)

  // 1) Context cache — system + tool schema 를 cachedContents 로 (1024 토큰 미만이면 null 반환)
  const toolsPayload = [{ function_declarations: config.tools }]
  const cache = await getOrCreateCache({
    model,
    systemInstruction: tenantAwarePrompt,
    tools: toolsPayload,
    ttlSeconds: 300,
    keyHint: `${config.agentType}:${params.ctx.tenantId ?? 'global'}`,
  })
  yield { type: 'cache_hit', data: { hit: cache?.fromReuse ?? false, cached: !!cache } }

  // 2) 히스토리 + 현재 메시지 구성
  const contents: any[] = [
    ...(params.session?.messages ?? []).slice(-HISTORY_TURNS_V2).map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: params.message }] },
  ]

  const toolsUsed: string[] = []
  const contextUpdate: Record<string, any> = {}
  let aggregatedText = ''
  let pendingAction: PendingActionInfo | null = null
  let pendingActionId: string | null = null

  for (let round = 0; round < maxRounds; round++) {
    // 3) streamGenerateContent 호출 (SSE)
    const body: any = {
      contents,
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    }
    if (cache) {
      body.cachedContent = cache.name
    } else {
      // 폴백: system + tools 를 매 호출에 포함 (테넌트 페르소나 반영된 프롬프트 사용)
      body.systemInstruction = { parts: [{ text: tenantAwarePrompt }] }
      body.tools = toolsPayload
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`

    let finalParts: any[] = []
    let roundText = ''

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '')
        console.error(`[jarvis-v2] stream HTTP ${res.status}:`, errText.slice(0, 300))
        yield { type: 'error', data: { reason: 'upstream_error', status: res.status } }
        return emptyResult(FALLBACK_MSG)
      }

      for await (const chunk of parseGeminiSSE(res.body)) {
        const parts = chunk?.candidates?.[0]?.content?.parts ?? []
        for (const p of parts) {
          if (typeof p.text === 'string' && p.text.length > 0) {
            roundText += p.text
            yield { type: 'text_delta', data: p.text }
          }
          if (p.functionCall) {
            yield { type: 'tool_use_start', data: { name: p.functionCall.name } }
          }
        }
        // 최종 parts 누적 (function_call 은 마지막 chunk 에 모두 포함)
        if (parts.length > 0) finalParts = mergeParts(finalParts, parts)

        // usageMetadata 누적 (마지막 chunk 에만 있음)
        const um = chunk?.usageMetadata
        if (um) {
          totalUsage.promptTokenCount += um.promptTokenCount ?? 0
          totalUsage.candidatesTokenCount += um.candidatesTokenCount ?? 0
          totalUsage.cachedContentTokenCount += um.cachedContentTokenCount ?? 0
          totalUsage.thoughtsTokenCount += um.thoughtsTokenCount ?? 0
        }
      }
    } catch (err) {
      console.error('[jarvis-v2] fetch 오류:', err)
      yield { type: 'error', data: { reason: 'fetch_error' } }
      return emptyResult(FALLBACK_MSG)
    }

    aggregatedText += roundText
    contents.push({ role: 'model', parts: finalParts })

    // 4) function call 추출 (parallel 지원)
    const toolCalls = finalParts
      .filter(p => p?.functionCall)
      .map(p => p.functionCall as { name: string; args: Record<string, any> })

    if (toolCalls.length === 0) {
      // text-only 응답 → 정상 종료 + 비용 기록 (fire-and-forget)
      void trackCost({
        ctx: params.ctx, sessionId: params.session?.id, agentType: config.agentType,
        model, usage: totalUsage, latencyMs: Date.now() - startedAt,
      })
      yield { type: 'done', data: { round, toolsUsed } }
      return {
        response: aggregatedText || roundText,
        toolsUsed,
        pendingAction: null,
        pendingActionId: null,
        contextUpdate,
      }
    }

    // 5) HITL 필터 — 하나라도 HITL tool 있으면 저장 후 중단
    const hitlCall = toolCalls.find(t => requiresHITL(t.name))
    if (hitlCall) {
      toolsUsed.push(hitlCall.name)
      const info = getHITLInfo(hitlCall.name)!
      const { data: pending } = await supabaseAdmin
        .from('jarvis_pending_actions')
        .insert({
          session_id: params.session?.id,
          agent_type: config.agentType,
          tool_name: hitlCall.name,
          tool_args: hitlCall.args || {},
          description: info.description,
          risk_level: info.riskLevel,
        })
        .select()
        .single()

      pendingActionId = pending?.id ?? null
      pendingAction = {
        id: pending?.id ?? '',
        toolName: hitlCall.name,
        description: info.description,
        riskLevel: info.riskLevel,
        args: hitlCall.args ?? {},
      }
      const confirmMsg = `다음 작업을 실행하려고 합니다:\n\n**${info.description}**\n\n승인하시겠습니까?`
      yield { type: 'text_delta', data: confirmMsg }
      yield { type: 'hitl_pending', data: pendingAction }
      void trackCost({
        ctx: params.ctx, sessionId: params.session?.id, agentType: config.agentType,
        model, usage: totalUsage, latencyMs: Date.now() - startedAt,
      })
      yield { type: 'done', data: { round, toolsUsed, pending: true } }
      return {
        response: aggregatedText + confirmMsg,
        toolsUsed,
        pendingAction,
        pendingActionId,
        contextUpdate,
      }
    }

    // 6) 병렬 tool 실행 (Gemini 2.5 parallel function calling)
    const executionResults = await Promise.all(
      toolCalls.map(async (t) => {
        toolsUsed.push(t.name)
        try {
          const result = await config.executeTool(t.name, t.args ?? {}, params.ctx)
          if (config.contextExtractor) {
            Object.assign(contextUpdate, config.contextExtractor(t.name, result))
          }
          // tool 로그 기록 (V1 과 동일 스키마)
          await supabaseAdmin.from('jarvis_tool_logs').insert({
            session_id: params.session?.id,
            agent_type: config.agentType,
            tool_name: t.name,
            tool_args: t.args ?? {},
            result,
            is_hitl: false,
          })
          return { name: t.name, ok: true as const, result }
        } catch (err: any) {
          return { name: t.name, ok: false as const, error: humanizeError(t.name, String(err?.message ?? err)) }
        }
      }),
    )

    // 이벤트 yield (stream 에 tool 결과 요약 반영)
    for (const r of executionResults) {
      yield { type: 'tool_result', data: { name: r.name, ok: r.ok } }
    }

    // 7) 다음 라운드 입력 — functionResponse 블록으로 변환
    contents.push({
      role: 'user',
      parts: executionResults.map(r => ({
        functionResponse: {
          name: r.name,
          response: r.ok ? { result: r.result } : { error: r.error },
        },
      })),
    })
  }

  // 라운드 상한 초과
  console.warn(`[jarvis-v2] MAX_ROUNDS(${maxRounds}) 초과 — ${config.agentType}, tools=${toolsUsed.join(',')}`)
  yield { type: 'text_delta', data: ESCALATE_MSG }
  void trackCost({
    ctx: params.ctx, sessionId: params.session?.id, agentType: config.agentType,
    model, usage: totalUsage, latencyMs: Date.now() - startedAt,
  })
  yield { type: 'done', data: { reason: 'max_rounds', toolsUsed } }
  return {
    response: aggregatedText || ESCALATE_MSG,
    toolsUsed,
    pendingAction: null,
    pendingActionId: null,
    contextUpdate,
  }
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────

function emptyResult(msg: string): AgentRunResult {
  return { response: msg, toolsUsed: [], pendingAction: null, pendingActionId: null, contextUpdate: {} }
}

/** Gemini SSE 스트림 파서. "data: {...}" 라인만 뽑아 JSON.parse 해서 yield */
async function* parseGeminiSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // 라인 단위 파싱 — SSE 는 "\n\n" 로 이벤트 구분
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // 마지막 (아직 미완 라인)

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        yield JSON.parse(payload)
      } catch {
        // 부분 청크 — 다음 loop 에서 완성됨
      }
    }
  }

  // flush
  if (buffer.startsWith('data:')) {
    const payload = buffer.slice(5).trim()
    if (payload && payload !== '[DONE]') {
      try { yield JSON.parse(payload) } catch { /* ignore */ }
    }
  }
}

/**
 * Gemini 는 streamGenerateContent 에서 chunk 마다 누적 parts 를 주는 게 아니라
 * 각 chunk 가 독립 parts. text 는 이어 붙이고 functionCall 은 그대로 보존.
 */
function mergeParts(acc: any[], incoming: any[]): any[] {
  const out = [...acc]
  for (const p of incoming) {
    if (typeof p.text === 'string') {
      // 마지막 part 가 text 면 이어 붙임, 아니면 새 part
      const last = out[out.length - 1]
      if (last && typeof last.text === 'string') {
        last.text += p.text
      } else {
        out.push({ text: p.text })
      }
    } else if (p.functionCall) {
      out.push({ functionCall: p.functionCall })
    } else {
      out.push(p)
    }
  }
  return out
}

function humanizeError(toolName: string, rawMsg: string): string {
  if (rawMsg.includes('duplicate key') || rawMsg.includes('already exists')) {
    return '이미 등록된 정보가 있어요. 중복 확인 후 다시 시도해 주세요.'
  }
  if (rawMsg.includes('violates foreign key') || rawMsg.includes('foreign key')) {
    return '연결된 정보를 찾을 수 없어요. 고객 또는 상품 정보를 먼저 확인해 주세요.'
  }
  if (rawMsg.includes('not found')) {
    return '해당 정보를 찾을 수 없어요. 이름이나 번호를 다시 확인해 주세요.'
  }
  if (toolName.includes('booking') || toolName.includes('customer')) {
    return '처리 중 잠깐 문제가 생겼어요. 다시 시도해 주시겠어요?'
  }
  return '일시적인 오류가 발생했어요.'
}
