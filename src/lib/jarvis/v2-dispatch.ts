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

// agent 공유 export (V1·V2 공용)
import {
  OPERATIONS_TOOLS,
  executeOperationsTool,
  OPERATIONS_CONTEXT_EXTRACTOR,
} from './agents/operations'
import { PRODUCTS_TOOLS, executeProductsTool } from './agents/products'
import { FINANCE_TOOLS, executeFinanceTool } from './agents/finance'
import { MARKETING_TOOLS, executeMarketingTool } from './agents/marketing'
import { SALES_TOOLS, executeSalesTool } from './agents/sales'
import { SYSTEM_TOOLS, executeSystemTool } from './agents/system'
import {
  OPERATIONS_PROMPT,
  PRODUCTS_PROMPT,
  FINANCE_PROMPT,
  MARKETING_PROMPT,
  SALES_PROMPT,
  SYSTEM_PROMPT_AGENT,
} from './prompts'

// concierge agent (Phase 4 — RAG 기반 고객 상담)
import {
  CONCIERGE_PROMPT,
  CONCIERGE_TOOLS,
  buildConciergeExecutor,
} from './agents/concierge'

/**
 * agent type → V2 config 조립. 전 agent V2 지원 (Phase 6 확장 완료).
 * ctx 는 concierge 등 tenant 스코프 executor 생성에 사용.
 *
 * 라우팅 전략 (Phase 6):
 *   - products 는 surface 에 따라 분기:
 *       · surface='customer' → concierge (RAG 상품 검색 + 고객 톤)
 *       · surface='admin'    → products agent (관리자용 상품 CRUD)
 */
function buildConfig(agentType: AgentType, ctx: JarvisContext): GeminiAgentV2Config | null {
  switch (agentType) {
    case 'operations':
      return {
        agentType: 'operations',
        systemPrompt: OPERATIONS_PROMPT,
        tools: OPERATIONS_TOOLS,
        executeTool: (name, args) => executeOperationsTool(name, args),
        contextExtractor: OPERATIONS_CONTEXT_EXTRACTOR,
      }
    case 'products':
      if (ctx.surface === 'customer') {
        return {
          agentType: 'products',
          systemPrompt: CONCIERGE_PROMPT,
          tools: CONCIERGE_TOOLS,
          executeTool: (name, args) => buildConciergeExecutor(ctx)(name, args),
        }
      }
      return {
        agentType: 'products',
        systemPrompt: PRODUCTS_PROMPT,
        tools: PRODUCTS_TOOLS,
        executeTool: (name, args) => executeProductsTool(name, args),
      }
    case 'finance':
      return {
        agentType: 'finance',
        systemPrompt: FINANCE_PROMPT,
        tools: FINANCE_TOOLS,
        executeTool: (name, args) => executeFinanceTool(name, args),
      }
    case 'marketing':
      return {
        agentType: 'marketing',
        systemPrompt: MARKETING_PROMPT,
        tools: MARKETING_TOOLS,
        executeTool: (name, args) => executeMarketingTool(name, args),
      }
    case 'sales':
      return {
        agentType: 'sales',
        systemPrompt: SALES_PROMPT,
        tools: SALES_TOOLS,
        executeTool: (name, args) => executeSalesTool(name, args),
      }
    case 'system':
      return {
        agentType: 'system',
        systemPrompt: SYSTEM_PROMPT_AGENT,
        tools: SYSTEM_TOOLS,
        executeTool: (name, args) => executeSystemTool(name, args),
      }
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
  const config = buildConfig(agentType, input.ctx)
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
