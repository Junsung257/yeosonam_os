/**
 * 여소남 OS — Jarvis V2 Dispatch (router → agent config → stream runner)
 *
 * 역할:
 *   1) routeMessage() 로 agent type 결정
 *   2) agent type 에 맞는 GeminiAgentV2Config 조립 (tool 정의·executeTool·systemPrompt)
 *   3) runGeminiAgentLoopV2() 호출
 *
 * 구현 상태 (Phase 2 초기):
 *   ✅ operations — 완전 V2 연결
 *   ⏳ products / finance / marketing / sales / system — TODO, Phase 2 후속 PR 에서 확장
 *
 * 미구현 agent 로 라우팅되면 V2 는 null 을 반환 → 라우트가 V1 경로로 폴백.
 */

import { routeMessage } from './claude-router'
import type { GeminiAgentV2Config, V2RunParams } from './gemini-agent-loop-v2'
import { runGeminiAgentLoopV2 } from './gemini-agent-loop-v2'
import type { StreamEvent } from './stream-encoder'
import type { AgentRunResult, AgentType, JarvisContext } from './types'

// operations agent 에서 공유된 실행 블록
import {
  OPERATIONS_TOOLS,
  executeOperationsTool,
  OPERATIONS_CONTEXT_EXTRACTOR,
} from './agents/operations'
import { OPERATIONS_PROMPT } from './prompts'

/** agent type → V2 config 조립. 아직 구현 안 된 agent 는 null. */
function buildConfig(agentType: AgentType): GeminiAgentV2Config | null {
  switch (agentType) {
    case 'operations':
      return {
        agentType: 'operations',
        systemPrompt: OPERATIONS_PROMPT,
        tools: OPERATIONS_TOOLS,
        executeTool: (name, args, _ctx) => executeOperationsTool(name, args),
        contextExtractor: OPERATIONS_CONTEXT_EXTRACTOR,
      }
    // TODO (Phase 2 후속): products, finance, marketing, sales, system 도 동일 패턴으로 추가
    case 'products':
    case 'finance':
    case 'marketing':
    case 'sales':
    case 'system':
      return null
  }
}

export interface DispatchInput {
  message: string
  session: any
  ctx: JarvisContext
}

export interface DispatchResult {
  agentType: AgentType
  routerConfidence: number
  supported: boolean            // false = V1 폴백 필요
  config: GeminiAgentV2Config | null
}

/** 라우팅 + config 조립만 먼저 반환 (SSE 라우트가 agent_picked 이벤트 먼저 보낼 수 있게) */
export async function prepareDispatch(input: DispatchInput): Promise<DispatchResult> {
  const routerResult = await routeMessage(input.message, input.session?.context ?? {})
  const agentType = routerResult.agent
  const config = buildConfig(agentType)
  return {
    agentType,
    routerConfidence: routerResult.confidence,
    supported: !!config,
    config,
  }
}

/** dispatch 후 실제 agent loop 실행 (stream generator 반환) */
export async function* runV2(
  dispatch: DispatchResult,
  params: V2RunParams,
): AsyncGenerator<StreamEvent, AgentRunResult | null> {
  if (!dispatch.supported || !dispatch.config) return null
  return yield* runGeminiAgentLoopV2(dispatch.config, params)
}
