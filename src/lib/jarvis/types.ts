export type AgentType = 'operations' | 'products' | 'finance' | 'marketing' | 'sales' | 'system'

export type RiskLevel = 'low' | 'medium' | 'high'

export interface JarvisMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  agent?: AgentType
  toolsUsed?: string[]
  timestamp: string
}

export interface JarvisContext {
  customerId?: string
  customerName?: string
  bookingId?: string
  bookingNo?: string
  packageId?: string
  recentTopic?: string
  // V2 멀티테넌트 스코프 (db/JARVIS_V2_DESIGN.md §4 참고, 현재는 optional)
  tenantId?: string
  userId?: string
  userRole?: 'platform_admin' | 'tenant_admin' | 'tenant_staff' | 'customer'
  surface?: 'admin' | 'customer' | 'api'
}

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
  requiresHITL?: boolean
  hitlDescription?: string
  hitlArgs?: Record<string, any>
  riskLevel?: RiskLevel
}

export interface RouterResult {
  agent: AgentType
  confidence: number
  reasoning: string
}

export interface AgentRunParams {
  message: string
  session: any
  user: any
  // V2: worker 가 tenant-scoped 쿼리를 만들 수 있도록 context 를 optional 로 전달
  // 값이 없으면 기존처럼 전역 쿼리 (legacy 경로)
  ctx?: JarvisContext
}

export interface AgentRunResult {
  response: string
  toolsUsed: string[]
  pendingAction: PendingActionInfo | null
  pendingActionId: string | null
  contextUpdate: Record<string, any>
}

export interface PendingActionInfo {
  id: string
  toolName: string
  description: string
  riskLevel: RiskLevel
  args: Record<string, any>
}
