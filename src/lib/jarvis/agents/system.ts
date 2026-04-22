import { supabaseAdmin } from '@/lib/supabase'
import { SYSTEM_PROMPT_AGENT } from '../prompts'
import { AgentRunParams, AgentRunResult } from '../types'
import { runGeminiAgentLoop } from '../gemini-agent-loop'
import { convertTools } from '../gemini-tool-format'

const SYSTEM_TOOLS_RAW = [
  {
    name: 'list_policies',
    description: '비즈니스 정책 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: '카테고리 (booking/payment/commission/marketing)' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'update_policy',
    description: '비즈니스 정책을 수정합니다. (승인 필요, 위험도 높음)',
    input_schema: {
      type: 'object' as const,
      required: ['id'],
      properties: {
        id: { type: 'string' },
        value: { type: 'string', description: '새로운 정책 값' },
        reason: { type: 'string', description: '변경 사유' }
      }
    }
  },
  {
    name: 'list_escalations',
    description: '에스컬레이션 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'open/resolved/dismissed' },
        priority: { type: 'string', description: 'low/medium/high/critical' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'get_audit_logs',
    description: '감사 로그를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        target_type: { type: 'string', description: '대상 타입 (jarvis/booking/customer 등)' },
        action: { type: 'string', description: '액션 타입' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
]

const SYSTEM_TOOLS = convertTools(SYSTEM_TOOLS_RAW)

async function executeTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'list_policies': {
      let query = supabaseAdmin
        .from('os_policies')
        .select('*')
        .order('category', { ascending: true })
        .limit(args.limit || 20)
      if (args.category) query = query.eq('category', args.category)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'list_escalations': {
      let query = supabaseAdmin
        .from('escalations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(args.limit || 10)
      if (args.status) query = query.eq('status', args.status)
      if (args.priority) query = query.eq('priority', args.priority)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'get_audit_logs': {
      let query = supabaseAdmin
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(args.limit || 20)
      if (args.target_type) query = query.eq('target_type', args.target_type)
      if (args.action) query = query.eq('action', args.action)
      if (args.date_from) query = query.gte('created_at', args.date_from)
      if (args.date_to) query = query.lte('created_at', args.date_to)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

// V2 (gemini-agent-loop-v2.ts) 공유 export
export { SYSTEM_TOOLS, SYSTEM_TOOLS_RAW }
export { executeTool as executeSystemTool }

export async function runSystemAgent(params: AgentRunParams): Promise<AgentRunResult> {
  return runGeminiAgentLoop({
    agentType: 'system',
    systemPrompt: SYSTEM_PROMPT_AGENT,
    tools: SYSTEM_TOOLS,
    executeTool,
  }, params)
}
