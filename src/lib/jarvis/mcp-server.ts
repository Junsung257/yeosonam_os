/**
 * 여소남 OS — MCP (Model Context Protocol) 서버
 *
 * 역할: Jarvis의 모든 agent tool을 표준 MCP 프로토콜로 노출.
 * 외부 AI (Claude, ChatGPT, Cursor)가 여소남OS 데이터를 조회/조작할 수 있게 함.
 *
 * MCP 스펙:
 *   - tools/list → { tools: McpToolSchema[] }
 *   - tools/call  → { name, arguments } → { content: [...] }
 *
 * 인증:
 *   - Authorization: Bearer <mcp_key> (tenant_tokens 테이블 조회)
 *   - platform_admin: 전체 tool 노출
 *   - tenant_admin: read tool + 조건부 write tool
 *   - 유효하지 않은 키: 401
 *
 * 노출 범위:
 *   - 조회 tool (scope=read): 전체 노출
 *   - 변경 tool (scope=write): 조건부 노출 (tenant_admin+ 이상)
 *   - 금융 tool (scope=admin): platform_admin 전용
 *
 * 사용 예:
 *   const mcpServer = new JarvisMcpServer()
 *   const tools = await mcpServer.listTools(authCtx)
 *   const result = await mcpServer.callTool('search_packages', { destination: '다낭' }, authCtx)
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getScopedClient } from './scoped-client'
import type { JarvisContext } from './types'
import {
  type McpToolSchema,
  type McpAuthContext,
  type McpCallToolResult,
  type McpToolScope,
} from './mcp-types'

// ============================================================
// Agent tool 임포트 (V2 Dispatch와 동일한 source of truth)
// ============================================================
import { OPERATIONS_TOOLS, executeOperationsTool } from './agents/operations'
import { PRODUCTS_TOOLS, executeProductsTool } from './agents/products'
import { FINANCE_TOOLS, executeFinanceTool } from './agents/finance'
import { MARKETING_TOOLS, executeMarketingTool } from './agents/marketing'
import { SALES_TOOLS, executeSalesTool } from './agents/sales'
import { SYSTEM_TOOLS, executeSystemTool } from './agents/system'

// ============================================================
// Tool 레지스트리 — 모든 agent tool을 MCP 스키마로 변환
// ============================================================

interface ToolRegistryEntry {
  mcpSchema: McpToolSchema
  execute: (args: Record<string, unknown>, ctx: JarvisContext) => Promise<any>
  agentType: string
}

function toMcpSchema(
  raw: { name: string; description: string; input_schema: any },
  agentType: string,
  scope: McpToolScope,
  requiresHITL: boolean,
): McpToolSchema {
  return {
    name: raw.name,
    description: raw.description,
    inputSchema: {
      type: 'object',
      properties: raw.input_schema.properties ?? {},
      required: raw.input_schema.required,
    },
    _meta: { scope, requiresHITL, agentType },
  }
}

/** tool name → (scope, requiresHITL) 매핑 */
const TOOL_SCOPE_MAP: Record<string, { scope: McpToolScope; hitl: boolean }> = {
  // --- operations ---
  search_bookings:           { scope: 'read', hitl: false },
  get_booking_detail:        { scope: 'read', hitl: false },
  create_booking:            { scope: 'write', hitl: true },
  update_booking_status:     { scope: 'write', hitl: true },
  search_customers:          { scope: 'read', hitl: false },
  create_customer:           { scope: 'write', hitl: true },
  update_customer:           { scope: 'write', hitl: true },
  match_payment:             { scope: 'write', hitl: true },
  list_unmatched_payments:   { scope: 'read', hitl: false },
  send_booking_guide:        { scope: 'write', hitl: true },
  find_duplicate_customers:  { scope: 'read', hitl: false },
  propose_merge_customers:   { scope: 'write', hitl: true },
  get_recent_errors:         { scope: 'read', hitl: false },

  // --- products ---
  search_packages:           { scope: 'read', hitl: false },
  get_package_detail:        { scope: 'read', hitl: false },
  recommend_package:         { scope: 'read', hitl: false },
  recommend_best_packages:   { scope: 'read', hitl: false },
  get_scoring_policy:        { scope: 'read', hitl: false },
  activate_policy:           { scope: 'write', hitl: true },
  ack_alert:                 { scope: 'write', hitl: false },
  list_admin_alerts:         { scope: 'read', hitl: false },
  update_package_status:     { scope: 'write', hitl: true },
  list_attractions:          { scope: 'read', hitl: false },
  search_land_operators:     { scope: 'read', hitl: false },
  propose_product_registration: { scope: 'write', hitl: true },
  register_product_draft:    { scope: 'write', hitl: true },
  update_package_field:      { scope: 'write', hitl: true },
  delete_package:            { scope: 'write', hitl: true },
  recommend_multi_intent:    { scope: 'read', hitl: false },
  recommend_compare_pair:    { scope: 'read', hitl: false },

  // --- finance ---
  get_dashboard_kpi:         { scope: 'admin', hitl: false },
  get_cashflow_forecast:     { scope: 'admin', hitl: false },
  list_ledger:               { scope: 'admin', hitl: false },
  get_tax_summary:           { scope: 'admin', hitl: false },
  list_settlements:          { scope: 'admin', hitl: false },
  create_settlement:         { scope: 'admin', hitl: true },
  list_pending_settlements:  { scope: 'admin', hitl: false },
  propose_bulk_confirm_settlements: { scope: 'admin', hitl: true },

  // --- marketing ---
  generate_card_news:              { scope: 'write', hitl: false },
  generate_sns_copy:               { scope: 'write', hitl: false },
  get_ad_performance:              { scope: 'read', hitl: false },
  list_campaigns:                  { scope: 'read', hitl: false },
  get_keyword_performance:         { scope: 'read', hitl: false },
  propose_blog_draft:              { scope: 'write', hitl: true },
  get_keyword_stats:               { scope: 'read', hitl: false },
  get_optimization_logs:           { scope: 'read', hitl: false },
  get_ad_budget_summary:           { scope: 'read', hitl: false },
  run_ad_optimization:             { scope: 'write', hitl: true },
  get_content_performance_summary: { scope: 'read', hitl: false },
  list_admin_alerts_marketing:     { scope: 'read', hitl: false },

  // --- sales ---
  list_affiliates:           { scope: 'read', hitl: false },
  get_affiliate_performance: { scope: 'read', hitl: false },
  detect_anomaly:            { scope: 'read', hitl: false },
  draft_monthly_settlement:  { scope: 'write', hitl: true },
  list_commission_policies:  { scope: 'read', hitl: false },
  preview_commission_policy: { scope: 'read', hitl: false },
  draft_commission_policy:   { scope: 'write', hitl: true },
  send_content_24h_report:   { scope: 'write', hitl: false },

  // --- system ---
  list_policies:             { scope: 'read', hitl: false },
  update_policy:             { scope: 'admin', hitl: true },
  list_escalations:          { scope: 'read', hitl: false },
  get_audit_logs:            { scope: 'admin', hitl: false },
}

function buildRegistry(): ToolRegistryEntry[] {
  const entries: ToolRegistryEntry[] = []

  const addAgent = (
    agentType: string,
    tools: any[],
    exec: (name: string, args: any) => Promise<any>,
  ) => {
    for (const t of tools) {
      const mapping = TOOL_SCOPE_MAP[t.name]
      if (!mapping) continue // 미등록 tool은 스킵
      entries.push({
        mcpSchema: toMcpSchema(t, agentType, mapping.scope, mapping.hitl),
        execute: (args, ctx) => exec(t.name, { ...args, _ctx: undefined }),
        agentType,
      })
    }
  }

  addAgent('operations', OPERATIONS_TOOLS, executeOperationsTool)
  addAgent('products', PRODUCTS_TOOLS, executeProductsTool)
  addAgent('finance', FINANCE_TOOLS, executeFinanceTool)
  addAgent('marketing', MARKETING_TOOLS, executeMarketingTool)
  addAgent('sales', SALES_TOOLS, executeSalesTool)
  addAgent('system', SYSTEM_TOOLS, executeSystemTool)

  return entries
}

/** tool name → registry entry 캐시 */
let _registry: ToolRegistryEntry[] | null = null
function getRegistry(): ToolRegistryEntry[] {
  if (!_registry) _registry = buildRegistry()
  return _registry
}

// ============================================================
// 권한 검사
// ============================================================

function canAccess(scope: McpToolScope, auth: McpAuthContext): boolean {
  const role = auth.userRole ?? 'tenant_staff'
  switch (scope) {
    case 'read':
      return true // 모든 인증된 사용자
    case 'write':
      return role === 'tenant_admin' || role === 'platform_admin'
    case 'admin':
      return role === 'platform_admin'
  }
}

// ============================================================
// API 키 인증
// ============================================================

const API_KEY_CACHE = new Map<string, { tenantId: string; role: McpAuthContext['userRole'] }>()
const API_KEY_CACHE_TTL = 60_000 // 1분
let _apiKeyLastFetch = 0

async function resolveApiKey(apiKey: string): Promise<McpAuthContext | null> {
  const now = Date.now()

  // 캐시 확인
  const cached = API_KEY_CACHE.get(apiKey)
  if (cached && now - _apiKeyLastFetch < API_KEY_CACHE_TTL) {
    return {
      tenantId: cached.tenantId,
      userId: undefined,
      userRole: cached.role,
    }
  }

  // DB 조회 (tenant_tokens 테이블)
  try {
    const { data, error } = await supabaseAdmin
      .from('tenant_tokens')
      .select('tenant_id, role, is_active')
      .eq('token', apiKey)
      .eq('is_active', true)
      .single()

    if (error || !data) return null

    const role = (data.role as McpAuthContext['userRole']) ?? 'tenant_staff'
    const result = {
      tenantId: data.tenant_id as string,
      userId: undefined,
      userRole: role,
    }

    // 캐시
    API_KEY_CACHE.set(apiKey, { tenantId: data.tenant_id as string, role })
    _apiKeyLastFetch = now

    return result
  } catch {
    return null
  }
}

// ============================================================
// MCP 서버 클래스
// ============================================================

export class JarvisMcpServer {
  /**
   * tools/list — 사용 가능한 tool 목록 반환
   * auth 권한에 따라 필터링됨
   */
  async listTools(auth: McpAuthContext): Promise<{ tools: McpToolSchema[] }> {
    const registry = getRegistry()
    const tools = registry
      .filter((entry) => canAccess(entry.mcpSchema._meta!.scope, auth))
      .map((entry) => entry.mcpSchema)

    return { tools }
  }

  /**
   * tools/call — 특정 tool 호출
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    auth: McpAuthContext,
  ): Promise<McpCallToolResult> {
    const registry = getRegistry()
    const entry = registry.find((e) => e.mcpSchema.name === name)

    if (!entry) {
      return {
        content: [{ type: 'text', text: `알 수 없는 tool: ${name}` }],
        isError: true,
      }
    }

    // 권한 검사
    if (!canAccess(entry.mcpSchema._meta!.scope, auth)) {
      return {
        content: [{ type: 'text', text: `권한 부족: ${entry.mcpSchema._meta!.scope} 스코프 필요` }],
        isError: true,
      }
    }

    // HITL tool은 경고 메시지 추가
    let warning = ''
    if (entry.mcpSchema._meta!.requiresHITL) {
      warning = '\n\n⚠️ 이 작업은 관리자 승인(HITL)이 필요합니다. 실제 실행 전 확인 절차가 진행됩니다.'
    }

    // JarvisContext 구성
    const ctx: JarvisContext = {
      tenantId: auth.tenantId,
      userId: auth.userId,
      userRole: auth.userRole,
      surface: 'api',
    }

    try {
      const result = await entry.execute(args, ctx)
      const text = JSON.stringify(result, null, 2)
      return {
        content: [{ type: 'text', text: text + warning }],
        isError: false,
      }
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `오류: ${err.message ?? String(err)}` }],
        isError: true,
      }
    }
  }

  /**
   * HTTP 요청을 MCP 응답으로 변환 (API Route에서 사용)
   */
  async handleRequest(
    body: { method: string; params?: Record<string, unknown> },
    auth?: McpAuthContext,
  ): Promise<McpCallToolResult | { tools: McpToolSchema[] }> {
    if (!auth) {
      return {
        content: [{ type: 'text', text: '인증 필요: Authorization 헤더에 Bearer 토큰을 전송하세요.' }],
        isError: true,
      }
    }

    switch (body.method) {
      case 'tools/list':
        return this.listTools(auth)

      case 'tools/call': {
        const params = body.params ?? {}
        const name = params.name as string | undefined
        const args = params.arguments as Record<string, unknown> | undefined
        if (!name) {
          return {
            content: [{ type: 'text', text: '필수 파라미터 누락: name' }],
            isError: true,
          }
        }
        return this.callTool(name, args ?? {}, auth)
      }

      default:
        return {
          content: [{ type: 'text', text: `알 수 없는 메서드: ${body.method}` }],
          isError: true,
        }
    }
  }

  /** Authorization 헤더에서 API 키 추출 및 검증 */
  async authenticate(authorization?: string): Promise<McpAuthContext | null> {
    if (!authorization) return null

    const match = authorization.match(/^Bearer\s+(.+)$/i)
    if (!match) return null

    return resolveApiKey(match[1])
  }
}

/** 싱글톤 인스턴스 */
export const mcpServer = new JarvisMcpServer()

// 캐시 무효화 (API 키 추가/삭제/비활성화 시 호출)
export function invalidateMcpAuthCache() {
  API_KEY_CACHE.clear()
  _apiKeyLastFetch = 0
}

/** 레지스트리 초기화 (테스트/캐시 리셋용) */
export function resetMcpRegistry() {
  _registry = null
}

export { getRegistry } // 외부 introspection 용
