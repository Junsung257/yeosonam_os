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
