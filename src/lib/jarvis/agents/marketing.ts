import { supabaseAdmin } from '@/lib/supabase'
import { MARKETING_PROMPT } from '../prompts'
import { AgentRunParams, AgentRunResult } from '../types'
import { runGeminiAgentLoop } from '../gemini-agent-loop'
import { convertTools } from '../gemini-tool-format'

const MARKETING_TOOLS_RAW = [
  {
    name: 'generate_card_news',
    description: '패키지 기반 카드뉴스를 자동 생성합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['package_id'],
      properties: {
        package_id: { type: 'string', description: '패키지 ID' },
        style: { type: 'string', description: '스타일 (감성/실용/프리미엄)' },
        slide_count: { type: 'number', description: '슬라이드 수 (기본 5)' }
      }
    }
  },
  {
    name: 'generate_sns_copy',
    description: 'SNS 카피를 생성합니다. DB 저장 없이 바로 반환.',
    input_schema: {
      type: 'object' as const,
      properties: {
        package_id: { type: 'string' },
        platform: { type: 'string', description: 'instagram/blog/threads' },
        tone: { type: 'string', description: '톤 (감성/유머/정보)' },
        topic: { type: 'string', description: '자유 주제 (패키지 없을 때)' }
      }
    }
  },
  {
    name: 'get_ad_performance',
    description: '광고 성과를 조회합니다 (ROAS, 클릭, 전환).',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        platform: { type: 'string', description: 'meta/naver/google' }
      }
    }
  },
  {
    name: 'list_campaigns',
    description: '캠페인 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'active/paused/completed' },
        platform: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'get_keyword_performance',
    description: '키워드별 광고 성과를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string' },
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'propose_blog_draft',
    description: '블로그 초안을 기안합니다. (승인 필요) agent_actions 에 기록되고 관리자가 확인 후 /admin/blog 에서 실제 발행.',
    input_schema: {
      type: 'object' as const,
      required: ['topic'],
      properties: {
        topic: { type: 'string', description: '블로그 주제' },
        destination: { type: 'string', description: '여행지 (태깅)' },
        package_id: { type: 'string', description: '연관 상품 ID (있으면)' },
        angle: { type: 'string', description: '앵글 (정보/감성/비교/체크리스트 등)' },
        target_length: { type: 'number', description: '목표 글자 수 (기본 2000)' },
      },
    },
  },
]

const MARKETING_TOOLS = convertTools(MARKETING_TOOLS_RAW)

async function executeTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'generate_sns_copy': {
      if (args.package_id) {
        const { data } = await supabaseAdmin
          .from('travel_packages')
          .select('title, destination, base_price, highlights, duration_days')
          .eq('id', args.package_id)
          .limit(1)
        return { package: data?.[0], platform: args.platform || 'instagram', tone: args.tone || '감성' }
      }
      return { topic: args.topic, platform: args.platform || 'instagram', tone: args.tone || '감성' }
    }
    case 'get_ad_performance': {
      let query = supabaseAdmin
        .from('ad_performances')
        .select('*')
        .order('date', { ascending: false })
        .limit(30)
      if (args.date_from) query = query.gte('date', args.date_from)
      if (args.date_to) query = query.lte('date', args.date_to)
      if (args.platform) query = query.eq('platform', args.platform)
      const { data, error } = await query
      if (error) throw error
      const totalSpend = data?.reduce((s: number, d: any) => s + (d.spend || 0), 0) || 0
      const totalRevenue = data?.reduce((s: number, d: any) => s + (d.revenue || 0), 0) || 0
      const totalClicks = data?.reduce((s: number, d: any) => s + (d.clicks || 0), 0) || 0
      const totalConversions = data?.reduce((s: number, d: any) => s + (d.conversions || 0), 0) || 0
      return { totalSpend, totalRevenue, roas: totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : 0, totalClicks, totalConversions, days: data?.length }
    }
    case 'list_campaigns': {
      let query = supabaseAdmin
        .from('campaigns')
        .select('id, name, platform, status, budget, spend, impressions, clicks, conversions, created_at')
        .order('created_at', { ascending: false })
        .limit(args.limit || 10)
      if (args.status) query = query.eq('status', args.status)
      if (args.platform) query = query.eq('platform', args.platform)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'get_keyword_performance': {
      let query = supabaseAdmin
        .from('search_keywords')
        .select('*')
        .order('clicks', { ascending: false })
        .limit(args.limit || 20)
      if (args.keyword) query = query.ilike('keyword', `%${args.keyword}%`)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'propose_blog_draft': {
      if (!args.topic) throw new Error('topic 필수')
      const summary = `[블로그 초안 기안] ${args.destination ? `[${args.destination}] ` : ''}${args.topic}${args.angle ? ` (${args.angle})` : ''}`
      const { data, error } = await supabaseAdmin
        .from('agent_actions')
        .insert({
          agent_type: 'marketing',
          action_type: 'blog_draft',
          summary,
          payload: {
            topic: args.topic,
            destination: args.destination ?? null,
            package_id: args.package_id ?? null,
            angle: args.angle ?? null,
            target_length: args.target_length ?? 2000,
          },
          requested_by: 'jarvis',
          priority: 'normal',
        })
        .select()
      if (error) throw error
      return { proposed: true, action_id: data?.[0]?.id, summary, next_step: '관리자가 /admin/blog 에서 승인 후 발행' }
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

// V2 (gemini-agent-loop-v2.ts) 공유 export
export { MARKETING_TOOLS, MARKETING_TOOLS_RAW }
export { executeTool as executeMarketingTool }

export async function runMarketingAgent(params: AgentRunParams): Promise<AgentRunResult> {
  return runGeminiAgentLoop({
    agentType: 'marketing',
    systemPrompt: MARKETING_PROMPT,
    tools: MARKETING_TOOLS,
    executeTool,
  }, params)
}
