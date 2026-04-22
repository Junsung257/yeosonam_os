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

import { runGeminiAgentLoop } from '../gemini-agent-loop'
import { convertTools } from '../gemini-tool-format'
import { retrieve } from '../rag/retriever'
import { YEOSONAM_BUSINESS_RULES } from '../prompts'
import type { AgentRunParams, AgentRunResult, JarvisContext } from '../types'

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
- knowledge_search: 상품/블로그/관광지/정책 지식베이스 검색
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
] as const

const CONCIERGE_TOOLS = convertTools(CONCIERGE_TOOLS_RAW as any)

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
        // LLM 이 소비하기 쉽게 slim 형태로
        return hits.map(h => ({
          title: h.sourceTitle,
          source: h.sourceType,
          url: h.sourceUrl,
          excerpt: h.chunkText.slice(0, 500),
          score: Number(h.score.toFixed(3)),
        }))
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }
}

export async function runConciergeAgent(params: AgentRunParams): Promise<AgentRunResult> {
  const ctx: JarvisContext = params.ctx ?? {}
  return runGeminiAgentLoop({
    agentType: 'operations', // AgentType 유니온에 'concierge' 미등록 상태 — 임시로 operations 로 logging
    systemPrompt: CONCIERGE_PROMPT,
    tools: CONCIERGE_TOOLS,
    executeTool: buildExecutor(ctx),
  }, params)
}

export { CONCIERGE_PROMPT, CONCIERGE_TOOLS, CONCIERGE_TOOLS_RAW, buildExecutor as buildConciergeExecutor }
