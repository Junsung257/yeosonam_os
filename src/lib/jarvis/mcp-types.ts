/**
 * 여소남 OS — MCP (Model Context Protocol) 타입 정의
 *
 * MCP 표준 스펙 (JSON-RPC 2.0 기반):
 *   - tools/list: 사용 가능한 tool 목록 반환
 *   - tools/call: 특정 tool 호출 + 결과 반환
 *   - resources/list: 리소스 목록 반환 (선택)
 *   - resources/read: 리소스 읽기 (선택)
 *
 * 참고: https://spec.modelcontextprotocol.io/
 */

export type McpToolScope = 'read' | 'write' | 'admin'

/** MCP Tool 스키마 (tools/list 응답) */
export interface McpToolSchema {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
  /** 내부 메타: 노출 범위 제어용 */
  _meta?: {
    scope: McpToolScope
    requiresHITL: boolean
    agentType: string
  }
}

/** JSON-RPC 2.0 요청 */
export interface McpJsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

/** JSON-RPC 2.0 응답 */
export interface McpJsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/** tools/list 결과 */
export interface McpListToolsResult {
  tools: McpToolSchema[]
}

/** tools/call 파라미터 */
export interface McpCallToolParams {
  name: string
  arguments: Record<string, unknown>
}

/** tools/call 결과 */
export interface McpCallToolResult {
  content: Array<{
    type: 'text' | 'resource'
    text?: string
    resource?: unknown
  }>
  isError?: boolean
}

/** MCP 인증 컨텍스트 */
export interface McpAuthContext {
  tenantId?: string
  userId?: string
  userRole?: 'platform_admin' | 'tenant_admin' | 'tenant_staff'
  apiKeyId?: string
}
