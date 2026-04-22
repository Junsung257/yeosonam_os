import { supabaseAdmin } from '@/lib/supabase'
import { PRODUCTS_PROMPT } from '../prompts'
import { AgentRunParams, AgentRunResult } from '../types'
import { runGeminiAgentLoop } from '../gemini-agent-loop'
import { convertTools } from '../gemini-tool-format'

const PRODUCTS_TOOLS_RAW = [
  {
    name: 'search_packages',
    description: '패키지 목록을 검색합니다. 목적지, 날짜, 예산으로 필터링 가능합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        destination: { type: 'string', description: '목적지 (예: 장가계, 다낭, 방콕)' },
        departure_from: { type: 'string', description: '출발일 시작 (YYYY-MM-DD)' },
        departure_to: { type: 'string', description: '출발일 끝 (YYYY-MM-DD)' },
        min_price: { type: 'number', description: '최소 가격' },
        max_price: { type: 'number', description: '최대 가격' },
        status: { type: 'string', description: '상품 상태 (ACTIVE/DRAFT 등)' },
        limit: { type: 'number', description: '조회 개수 (기본 10)' }
      }
    }
  },
  {
    name: 'get_package_detail',
    description: '패키지 상세 정보와 일정표를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      required: ['package_id'],
      properties: {
        package_id: { type: 'string', description: '패키지 ID (UUID)' }
      }
    }
  },
  {
    name: 'recommend_package',
    description: '조건에 맞는 상품을 최대 3개 추천합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        destination: { type: 'string' },
        month: { type: 'string', description: '여행 월 (예: 5월)' },
        budget_per_person: { type: 'number' },
        adult_count: { type: 'number' },
        preferences: { type: 'string', description: '선호사항 (골프, 휴양, 쇼핑 등)' }
      }
    }
  },
  {
    name: 'update_package_status',
    description: '패키지 상태를 변경합니다. (승인 필요)',
    input_schema: {
      type: 'object' as const,
      required: ['package_id', 'status'],
      properties: {
        package_id: { type: 'string' },
        status: { type: 'string', description: 'DRAFT/REVIEW_NEEDED/APPROVED/ACTIVE' }
      }
    }
  },
  {
    name: 'list_attractions',
    description: '관광지 DB를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string', description: '국가' },
        city: { type: 'string', description: '도시' },
        category: { type: 'string', description: '카테고리 (관광/맛집/쇼핑/액티비티)' },
        query: { type: 'string', description: '검색어' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'search_land_operators',
    description: '랜드사를 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
]

const PRODUCTS_TOOLS = convertTools(PRODUCTS_TOOLS_RAW)

async function executeTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'search_packages': {
      let query = supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, base_price, departure_date, duration_days, status, created_at')
        .order('created_at', { ascending: false })
        .limit(args.limit || 10)
      if (args.destination) query = query.ilike('destination', `%${args.destination}%`)
      if (args.departure_from) query = query.gte('departure_date', args.departure_from)
      if (args.departure_to) query = query.lte('departure_date', args.departure_to)
      if (args.min_price) query = query.gte('base_price', args.min_price)
      if (args.max_price) query = query.lte('base_price', args.max_price)
      if (args.status) query = query.eq('status', args.status)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'get_package_detail': {
      const { data, error } = await supabaseAdmin
        .from('travel_packages')
        .select('*')
        .eq('id', args.package_id)
        .limit(1)
      if (error) throw error
      return data?.[0] || null
    }
    case 'recommend_package': {
      let query = supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, base_price, departure_date, duration_days, highlights, status')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false })
        .limit(3)
      if (args.destination) query = query.ilike('destination', `%${args.destination}%`)
      if (args.budget_per_person) query = query.lte('base_price', args.budget_per_person)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'list_attractions': {
      let query = supabaseAdmin
        .from('attractions')
        .select('id, name, country, city, category, short_desc, rating')
        .order('rating', { ascending: false })
        .limit(args.limit || 10)
      if (args.country) query = query.ilike('country', `%${args.country}%`)
      if (args.city) query = query.ilike('city', `%${args.city}%`)
      if (args.category) query = query.eq('category', args.category)
      if (args.query) query = query.ilike('name', `%${args.query}%`)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    case 'search_land_operators': {
      let query = supabaseAdmin
        .from('land_operators')
        .select('id, name, country, contact_name, contact_phone, rating, is_active')
        .eq('is_active', true)
        .limit(args.limit || 10)
      if (args.country) query = query.ilike('country', `%${args.country}%`)
      if (args.query) query = query.ilike('name', `%${args.query}%`)
      const { data, error } = await query
      if (error) throw error
      return data
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

// V2 (gemini-agent-loop-v2.ts) 공유 export
export { PRODUCTS_TOOLS, PRODUCTS_TOOLS_RAW }
export { executeTool as executeProductsTool }

export async function runProductsAgent(params: AgentRunParams): Promise<AgentRunResult> {
  return runGeminiAgentLoop({
    agentType: 'products',
    systemPrompt: PRODUCTS_PROMPT,
    tools: PRODUCTS_TOOLS,
    executeTool,
  }, params)
}
