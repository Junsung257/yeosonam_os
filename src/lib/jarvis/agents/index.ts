// ─── 자비스 Agent 통합 export ──────────────────────────────────────────────
// 새 Claude 기반 Agent 시스템

export { runOperationsAgent } from './operations'
export { runProductsAgent } from './products'
export { runFinanceAgent } from './finance'
export { runMarketingAgent } from './marketing'
export { runSalesAgent } from './sales'
export { runSystemAgent } from './system'

// 기존 Gemini 기반 호환 (buildAgentConfig는 /api/jarvis에서 더 이상 사용 안 함)
// 옛 booking.ts, product.ts의 Tool 선언은 그대로 유지
export { BOOKING_TOOL_DECLARATIONS } from './booking'
export { PRODUCT_TOOL_DECLARATIONS } from './product'

// 옛 finance Tool 선언은 새 파일에서 제거됨 → 빈 배열로 호환
export const FINANCE_TOOL_DECLARATIONS: unknown[] = []

// 옛 buildAgentConfig (Gemini 호환) — 더 이상 메인 라우트에서 사용 안 함
import type { IntentMode } from '../router'
import { BOOKING_TOOL_DECLARATIONS as BOOKING_TOOLS } from './booking'
import { PRODUCT_TOOL_DECLARATIONS as PRODUCT_TOOLS } from './product'

export interface AgentConfig {
  tools: unknown[]
  systemPrompt: string
}

export function buildAgentConfig(mode: IntentMode): AgentConfig {
  switch (mode) {
    case 'PRODUCT_MODE':
      return { tools: PRODUCT_TOOLS, systemPrompt: '' }
    case 'FINANCE_MODE':
      return { tools: [], systemPrompt: '' }
    case 'BOOKING_MODE':
      return { tools: BOOKING_TOOLS, systemPrompt: '' }
    case 'MULTI_MODE':
    default:
      return { tools: [...PRODUCT_TOOLS, ...BOOKING_TOOLS], systemPrompt: '' }
  }
}
