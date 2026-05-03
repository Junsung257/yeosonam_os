/**
 * 여소남 OS — Concierge Agent (고객 상담 + RAG 지식베이스)
 *
 * 설계 근거: db/JARVIS_V2_DESIGN.md §B.3.5
 *
 * 역할:
 *   - 고객 질문에 답하기 위해 knowledge_search tool 로 RAG 검색
 *   - 상품 추천, 정책 안내, 관광지 정보 제공
 *   - tenant 스코프 자동 적용 (ctx.tenantId 기반)
 *
 * V1 에는 없는 신규 agent — V2 전용.
 * v2-dispatch 에 'concierge' 라우팅이 추가되면 활성화됨.
 */

import { runDeepSeekAgentLoop } from '../deepseek-agent-loop'
import { retrieve } from '../rag/retriever'
import { YEOSONAM_BUSINESS_RULES } from '../prompts'
import type { AgentRunParams, AgentRunResult, JarvisContext } from '../types'
import { supabaseAdmin } from '@/lib/supabase'
import { recommendBestPackages } from '@/lib/scoring/recommend'

const CONCIERGE_PROMPT = `당신은 여소남 여행사의 AI 컨시어지입니다. 고객의 여행 상담을 돕습니다.

${YEOSONAM_BUSINESS_RULES}

## 답변 원칙
1. 고객 질문을 받으면 먼저 knowledge_search 로 관련 상품/블로그/관광지를 조회하세요.
2. 검색 결과에 있는 정보만 근거로 답하세요. 없는 가격/일정/약속은 절대 만들지 마세요.
3. 상품 추천 시 최대 3개까지, 각 상품의 핵심 셀링포인트(호텔/항공/관광지)를 1~2개 포함하세요.
4. 고객에게는 "판매가" 용어를 사용하고, 원가·커미션·랜드사명은 노출하지 마세요.
5. "환불 가능합니다", "자리 확보해드렸습니다", "할인해드릴게요" 같은 회사 권한 밖 약속은 금지.
   필요하면 "담당자 확인 후 다시 안내드리겠습니다" 라고 에스컬레이션.

사용 가능한 Tool:
- knowledge_search: 상품/블로그/관광지/정책 지식베이스 검색 (RAG hybrid: vector + BM25 + RRF)
- recommend_best_packages: 같은 목적지·날짜 그룹에서 점수 1위 패키지 추천 (Effective Price + TOPSIS)
- recommend_compare_pair: 두 패키지 1대1 자연어 비교 ("10만 비싸지만 5성+마사지")
- plan_free_travel: 고객 자유여행 요청 시 실시간 항공+호텔+액티비티 견적 조회 (MRT 연동). 자유여행 언급 시 호출. 도구 결과의 plannerUrl(세션 링크)을 고객에게 그대로 전달하면 동일 견적을 다시 열 수 있음.

## 답변 흐름 (v6, 2026-04-30)
1. 첫 메시지면 knowledge_search 로 사용자 질문 핵심 키워드 검색
2. 검색 결과 분기:
   - 상품 매칭 있음 + destination/날짜 명시 → recommend_best_packages 추가 호출 (점수 1위 우선 추천)
   - 비교 요청 ("A vs B", "차이") → recommend_compare_pair 호출 → diff.summary 답변
   - 블로그/관광지만 매칭 → "관련 가이드는 [블로그 url]에서 확인 가능" 안내
   - 0건 → "어떤 일정/예산/스타일로 찾으시나요?" 정중 재질문
3. 점수 숫자(topsis_score, rank) 노출 금지 — breakdown.why 자연어만
4. 가격 비공개 + "자세한 견적은 카카오톡 채널로 문의 주세요" 끝맺음

## 답변 예시 (앵커)

[Q] "다낭 5월 5일 출발 가족 여행 추천해줘"

1. knowledge_search("다낭 5월 가족여행") → package hits 3개
2. recommend_best_packages({ destination: "다낭", departure_date: "2026-05-05" }) → 그 날 1위
3. 답변:
"다낭 5/5 출발 베스트 추천드릴게요 ✈️

🥇 셀렉텀 노아 3박5일
   5성 호텔 + 무료 옵션 5개 (시푸드/스파/2층버스 등) + 직항. 쇼핑 일정 없음.

가족 여행이면 식사 횟수와 호텔 등급 비중을 더 높여 보고 있어요.
자세한 견적은 카카오톡 채널로 문의 주세요 :)"
`

const CONCIERGE_TOOLS_RAW = [
  {
    name: 'knowledge_search',
    description: '고객 질문에 답하기 위해 여소남 지식베이스를 검색합니다. 상품·블로그·관광지·정책 포함.',
    input_schema: {
      type: 'object' as const,
      required: ['query'],
      properties: {
        query: { type: 'string', description: '검색 쿼리 (고객 질문 또는 핵심 키워드)' },
        source_types: {
          type: 'array',
          items: { type: 'string' },
          description: "검색 범위 제한 ['package','blog','attraction','policy']. 미지정 시 전체."
        },
        limit: { type: 'number', description: '결과 개수 (기본 5, 최대 10)' },
      },
    },
  },
  {
    name: 'recommend_best_packages',
    description: '같은 목적지·날짜 그룹 내 1위 패키지 (점수 시스템 v3). knowledge_search 후 destination·date 명시되면 호출.',
    input_schema: {
      type: 'object' as const,
      required: ['destination'],
      properties: {
        destination: { type: 'string' },
        departure_date: { type: 'string', description: 'YYYY-MM-DD' },
        duration_days: { type: 'number' },
        limit: { type: 'number', description: '기본 3' },
      },
    },
  },
  {
    name: 'recommend_compare_pair',
    description: '두 패키지 1대1 자연어 차이 ("10만 비싸지만 5성+마사지"). diff.summary 가 핵심 답변 한 줄.',
    input_schema: {
      type: 'object' as const,
      required: ['package_id_a', 'package_id_b'],
      properties: {
        package_id_a: { type: 'string' },
        package_id_b: { type: 'string' },
        departure_date: { type: 'string' },
      },
    },
  },
  {
    name: 'plan_free_travel',
    description: '고객이 자유여행 견적을 요청할 때 호출. 자연어 메시지 그대로 전달하면 항공+호텔+액티비티 실시간 가격과 여소남 패키지 비교가 반환됨.',
    input_schema: {
      type: 'object' as const,
      required: ['message'],
      properties: {
        message: {
          type: 'string',
          description: '고객 자유여행 요청 전문. 예: "5월 1일~5일 부산출발 다낭 성인2 아동2"',
        },
        customer_phone: { type: 'string', description: '고객 전화번호 (선택)' },
        customer_name:  { type: 'string', description: '고객 이름 (선택)' },
      },
    },
  },
] as const

const CONCIERGE_TOOLS = CONCIERGE_TOOLS_RAW as any

/**
 * ctx (tenantId) 를 클로저로 잡아 tool 실행기를 만든다.
 * 이렇게 하면 V1 루프의 `(name, args) => Promise<any>` 시그니처와 호환.
 */
function buildExecutor(ctx: JarvisContext) {
  return async function executeConciergeTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'knowledge_search': {
        const hits = await retrieve({
          query: args.query,
          tenantId: ctx.tenantId,
          sourceTypes: args.source_types,
          limit: Math.min(args.limit ?? 5, 10),
          rerank: true,
        })
        // LLM 이 소비하기 쉽게 slim 형태로 — package 는 source_id 추가 (recommend 도구로 chain 가능)
        return hits.map(h => ({
          title: h.sourceTitle,
          source: h.sourceType,
          source_id: h.sourceId,
          url: h.sourceUrl,
          excerpt: h.chunkText.slice(0, 500),
          score: Number(h.score.toFixed(3)),
        }))
      }
      case 'recommend_best_packages': {
        if (!args.destination) throw new Error('destination 필수')
        const result = await recommendBestPackages({
          destination: args.destination,
          departure_date: args.departure_date ?? null,
          duration_days: args.duration_days ?? null,
          limit: args.limit ?? 3,
        })
        // 점수 숫자 비공개 — why 사유만 노출
        return {
          group_size: result.group_size,
          ranked: result.ranked.map(r => ({
            package_id: r.package_id,
            title: r.title,
            destination: r.destination,
            departure_date: r.departure_date,
            list_price: r.list_price,
            rank: r.rank,
            why: r.breakdown.why,
            features: {
              hotel_avg_grade: r.features.hotel_avg_grade,
              shopping_count: r.features.shopping_count,
              free_option_count: r.features.free_option_count,
              is_direct_flight: r.features.is_direct_flight,
            },
          })),
        }
      }
      case 'recommend_compare_pair': {
        const aId = args.package_id_a as string
        const bId = args.package_id_b as string
        if (!aId || !bId) throw new Error('package_id_a, package_id_b 필수')
        let q = supabaseAdmin
          .from('package_scores')
          .select('package_id, departure_date, list_price, effective_price, rank_in_group, shopping_count, hotel_avg_grade, free_option_count, is_direct_flight, breakdown, travel_packages!inner(title, product_highlights)')
          .in('package_id', [aId, bId])
        if (args.departure_date) q = q.eq('departure_date', args.departure_date)
        const { data, error } = await q.limit(10)
        if (error) throw error
        const rows = (data ?? []) as unknown as Array<{
          package_id: string; departure_date: string; list_price: number; effective_price: number;
          rank_in_group: number; shopping_count: number; hotel_avg_grade: number | null;
          free_option_count: number; is_direct_flight: boolean;
          travel_packages: { title: string; product_highlights: string[] | null } | { title: string; product_highlights: string[] | null }[];
        }>
        const a = rows.find(r => r.package_id === aId)
        const b = rows.find(r => r.package_id === bId)
        if (!a || !b) return { error: '같은 출발일에 양쪽 패키지가 없어요' }
        const titleOf = (r: typeof a) => Array.isArray(r.travel_packages) ? r.travel_packages[0]?.title : r.travel_packages?.title
        const highlightsOf = (r: typeof a) => {
          const t = Array.isArray(r.travel_packages) ? r.travel_packages[0] : r.travel_packages
          return t?.product_highlights ?? []
        }
        const { comparePackages } = await import('@/lib/scoring/pairwise-diff')
        const featLite = (r: typeof a) => ({
          package_id: r.package_id, destination: '', departure_date: r.departure_date,
          duration_days: 0, list_price: r.list_price,
          shopping_count: r.shopping_count, hotel_avg_grade: r.hotel_avg_grade,
          meal_count: 0, free_option_count: r.free_option_count,
          is_direct_flight: r.is_direct_flight, land_operator_id: null, reliability_score: 0.7,
          days_since_created: null, confirmation_rate: 0, free_time_ratio: 0,
          korean_meal_count: 0, special_meal_count: 0, hotel_location: null, flight_time: null,
          climate_score: 50, popularity_score: 50, itinerary: null,
        })
        const diff = comparePackages(
          { features: featLite(a), effective_price: a.effective_price, product_highlights: highlightsOf(a) },
          { features: featLite(b), effective_price: b.effective_price, product_highlights: highlightsOf(b) },
        )
        return {
          a: { title: titleOf(a), list_price: a.list_price, rank: a.rank_in_group },
          b: { title: titleOf(b), list_price: b.list_price, rank: b.rank_in_group },
          summary: diff.summary,
          better: diff.better_axis,
          worse: diff.worse_axis,
        }
      }
      case 'plan_free_travel': {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
          ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
        if (!baseUrl) return { error: 'NEXT_PUBLIC_BASE_URL 환경변수 미설정' }

        const res = await fetch(`${baseUrl}/api/free-travel/plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message:       args.message,
            customerPhone: args.customer_phone,
            customerName:  args.customer_name,
          }),
        })
        if (!res.ok || !res.body) return { error: '견적 조회 실패' }

        // plan 엔드포인트는 SSE 스트림 반환 — 이벤트를 누적해 itinerary 조합
        const reader  = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let ev  = ''
        let dt  = ''
        const acc: Record<string, unknown> = {}

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('event: '))     ev = line.slice(7).trim()
            else if (line.startsWith('data: ')) dt = line.slice(6).trim()
            else if (line === '' && ev && dt) {
              try { acc[ev] = JSON.parse(dt) } catch { /* skip */ }
              ev = ''; dt = ''
            }
          }
        }

        const params     = (acc['params']     ?? {}) as Record<string, unknown>
        const flights    = (acc['flights']    ?? []) as any[]
        const hotels     = (acc['hotels']     ?? []) as any[]
        const activities = (acc['activities'] ?? []) as any[]
        const comparison = acc['comparison'] as any
        const summary    = acc['summary']    as any
        const doneEvt    = acc['done']       as any
        const sessionId  = doneEvt?.sessionId as string | undefined
        const plannerUrl = sessionId ? `${baseUrl}/free-travel?session=${encodeURIComponent(sessionId)}` : `${baseUrl}/free-travel`

        return {
          destination:       params.destination,
          nights:            params.nights,
          dateFrom:          params.dateFrom,
          dateTo:            params.dateTo,
          topFlight:         flights[0] ? `${flights[0].airline} ${flights[0].price?.toLocaleString()}원` : null,
          topHotel:          hotels[0]  ? `${hotels[0].name} 1박 ${hotels[0].pricePerNight?.toLocaleString()}원` : null,
          activityCount:     activities.length,
          totalMin:          comparison?.totalMin,
          totalMax:          comparison?.totalMax,
          aiSummary:         summary?.text,
          packageComparison: comparison,
          sessionId,
          plannerUrl,
        }
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }
}

export async function runConciergeAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const ctx: JarvisContext = params.ctx ?? {}
  return runDeepSeekAgentLoop({
    agentType: 'operations', // AgentType 유니온에 'concierge' 미등록 상태 — 임시로 operations 로 logging
    systemPrompt: CONCIERGE_PROMPT,
    tools: CONCIERGE_TOOLS,
    executeTool: buildExecutor(ctx),
  }, params)
}

export { CONCIERGE_PROMPT, CONCIERGE_TOOLS, CONCIERGE_TOOLS_RAW, buildExecutor as buildConciergeExecutor }
