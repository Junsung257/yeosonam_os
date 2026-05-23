/**
 * 여소남 OS — Jarvis V2 Dispatch (router → agent config → stream runner)
 *
 * 역할:
 *   1) routeMessage() 로 agent type 결정
 *   2) agent type 에 맞는 DeepSeekAgentV2Config 조립 (tool 정의·executeTool·systemPrompt)
 *   3) runDeepSeekAgentLoopV2() 호출
 *
 * 구현 상태 (Phase 2 초기):
 *   ✅ operations — 완전 V2 연결
 *   ⏳ products / finance / marketing / sales / system — TODO, Phase 2 후속 PR 에서 확장
 *
 * 미구현 agent 로 라우팅되면 V2 는 null 을 반환 → 라우트가 V1 경로로 폴백.
 */

import { routeMessage } from './claude-router'
import type { DeepSeekAgentV2Config, V2RunParams } from './deepseek-agent-loop-v2'
import { runDeepSeekAgentLoopV2 } from './deepseek-agent-loop-v2'
import type { StreamEvent } from './stream-encoder'
import type { AgentRunResult, AgentType, JarvisContext } from './types'
import { resolveSpecialist, type SpecialistPick } from './orchestration'

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
  getOperationsPrompt,
  getProductsPrompt,
  getFinancePrompt,
  getMarketingPrompt,
  getSalesPrompt,
  getSystemPrompt,
} from './prompts'

// concierge agent (Phase 4 — RAG 기반 고객 상담)
import {
  CONCIERGE_PROMPT,
  CONCIERGE_TOOLS,
  buildConciergeExecutor,
} from './agents/concierge'

// S1 매직링크 통합 — 게스트 모드 가드레일 (Air Canada 방지) + tool whitelist (defense-in-depth)
import { applyGuestGuardrail, filterGuestTools } from './guest-guardrail'
import { applyRequestContext } from './scoped-client'

/**
 * agent type → V2 config 조립. 전 agent V2 지원 (Phase 6 확장 완료).
 * ctx 는 concierge 등 tenant 스코프 executor 생성에 사용.
 *
 * 라우팅 전략 (Phase 6):
 *   - products 는 surface 에 따라 분기:
 *       · surface='customer' → concierge (RAG 상품 검색 + 고객 톤)
 *       · surface='admin'    → products agent (관리자용 상품 CRUD)
 */
async function buildConfig(agentType: AgentType, ctx: JarvisContext): Promise<DeepSeekAgentV2Config | null> {
  const config = await buildConfigRaw(agentType, ctx)
  if (!config) return null
  // S1: 게스트(매직링크 진입 고객) — systemPrompt 가드레일 + mutating tool 화이트리스트
  return {
    ...config,
    systemPrompt: applyGuestGuardrail(config.systemPrompt, ctx),
    tools: filterGuestTools(config.tools as Array<{ name?: string } & Record<string, unknown>>, ctx) as typeof config.tools,
  }
}

async function buildConfigRaw(agentType: AgentType, ctx: JarvisContext): Promise<DeepSeekAgentV2Config | null> {
  switch (agentType) {
    case 'operations':
      return {
        agentType: 'operations',
        systemPrompt: await getOperationsPrompt(),
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
        systemPrompt: await getProductsPrompt(),
        tools: PRODUCTS_TOOLS,
        executeTool: (name, args) => executeProductsTool(name, args),
      }
    case 'finance':
      return {
        agentType: 'finance',
        systemPrompt: await getFinancePrompt(),
        tools: FINANCE_TOOLS,
        executeTool: (name, args) => executeFinanceTool(name, args),
      }
    case 'marketing':
      return {
        agentType: 'marketing',
        systemPrompt: await getMarketingPrompt(),
        tools: MARKETING_TOOLS,
        executeTool: (name, args) => executeMarketingTool(name, args),
      }
    case 'sales':
      return {
        agentType: 'sales',
        systemPrompt: await getSalesPrompt(),
        tools: SALES_TOOLS,
        executeTool: (name, args) => executeSalesTool(name, args),
      }
    case 'system':
      return {
        agentType: 'system',
        systemPrompt: await getSystemPrompt(),
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
  config: DeepSeekAgentV2Config | null
  /** 2단 오케스트레이션 — 도메인 내 서브 팀 (로그·UI·추후 프롬프트 분기) */
  specialistPick: SpecialistPick
}

/** 라우팅 + config 조립만 먼저 반환 (SSE 라우트가 agent_picked 이벤트 먼저 보낼 수 있게) */
export async function prepareDispatch(input: DispatchInput): Promise<DispatchResult> {
  // Phase 0: 요청 컨텍스트 설정 (RLS tenant 격리 + 감사)
  await applyRequestContext(input.ctx)

  const routerResult = await routeMessage(input.message, input.session?.context ?? {})
  const agentType = routerResult.agent
  const config = await buildConfig(agentType, input.ctx)
  const specialistPick = resolveSpecialist(agentType, input.message, input.ctx)
  return {
    agentType,
    routerConfidence: routerResult.confidence,
    supported: !!config,
    config,
    specialistPick,
  }
}

export async function* runV2(
  dispatch: DispatchResult,
  params: V2RunParams,
): AsyncGenerator<StreamEvent, AgentRunResult | null> {
  if (!dispatch.supported || !dispatch.config) return null
  return yield* runDeepSeekAgentLoopV2(dispatch.config, params)
}
