/**
 * 여소남 OS — MCP API 엔드포인트
 *
 * 표준 MCP 프로토콜 (JSON-RPC 2.0)을 HTTP POST로 처리.
 * 외부 AI (Claude Desktop, Cursor IDE, 커스텀 에이전트)가 여소남OS tool에 접근 가능.
 *
 * 사용 예:
 *   curl -X POST https://yeosonam.com/api/mcp \
 *     -H "Authorization: Bearer <mcp_api_key>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"method":"tools/list","id":1}'
 *
 *   curl -X POST https://yeosonam.com/api/mcp \
 *     -H "Authorization: Bearer <mcp_api_key>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"method":"tools/call","params":{"name":"search_packages","arguments":{"destination":"다낭"}},"id":2}'
 */

import { NextRequest, NextResponse } from 'next/server'
import { mcpServer } from '@/lib/jarvis/mcp-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // 1. 인증
    const authHeader = request.headers.get('authorization')
    const auth = await mcpServer.authenticate(authHeader ?? undefined)

    if (!auth) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: 401,
            message: '인증 실패. 유효한 MCP API 키가 필요합니다.',
          },
        },
        { status: 401 },
      )
    }

    // 2. JSON-RPC 2.0 요청 파싱
    let body: { method: string; params?: Record<string, unknown>; id?: string | number }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error: 유효한 JSON이 아닙니다.' },
        },
        { status: 400 },
      )
    }

    if (!body.method) {
      return NextResponse.json(
        {
          jsonrpc: '2.0',
          id: body.id ?? null,
          error: { code: -32600, message: 'Invalid Request: method 필드가 필요합니다.' },
        },
        { status: 400 },
      )
    }

    const rpcId = body.id ?? 1

    // 3. MCP 메서드 라우팅
    switch (body.method) {
      case 'tools/list': {
        const result = await mcpServer.listTools(auth)
        return NextResponse.json({
          jsonrpc: '2.0',
          id: rpcId,
          result,
        })
      }

      case 'tools/call': {
        const params = body.params as Record<string, unknown>
        if (!params?.name) {
          return NextResponse.json(
            {
              jsonrpc: '2.0',
              id: rpcId,
              error: { code: -32602, message: 'Invalid params: name 필드가 필요합니다.' },
            },
            { status: 400 },
          )
        }
        const result = await mcpServer.callTool(
          params.name as string,
          (params.arguments ?? {}) as Record<string, unknown>,
          auth,
        )
        return NextResponse.json({
          jsonrpc: '2.0',
          id: rpcId,
          result,
        })
      }

      case 'resources/list':
        return NextResponse.json({
          jsonrpc: '2.0',
          id: rpcId,
          result: { resources: [] },
        })

      case 'resources/read':
        return NextResponse.json({
          jsonrpc: '2.0',
          id: rpcId,
          error: { code: -32601, message: 'Method not found: resources/read는 아직 구현되지 않았습니다.' },
        })

      default:
        return NextResponse.json(
          {
            jsonrpc: '2.0',
            id: rpcId,
            error: { code: -32601, message: `Method not found: ${body.method}` },
          },
          { status: 404 },
        )
    }
  } catch (err: any) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: `Internal error: ${err.message ?? String(err)}` },
      },
      { status: 500 },
    )
  }
}
