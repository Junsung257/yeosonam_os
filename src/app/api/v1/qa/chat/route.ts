/**
 * 여소남 OS — 외부 REST API V1 QA 채팅 엔드포인트 (Phase 3-2)
 *
 * POST /api/v1/qa/chat
 *
 * 헤더:
 *   Authorization: Bearer <api_key>  (필수. 스코프: qa:chat)
 *
 * 바디:
 *   {
 *     "message": "문의 내용",
 *     "history": [{ "role": "user", "content": "..." }],
 *     "session_id": "선택적 세션 ID"
 *   }
 *
 * 응답: application/x-ndjson (stream)
 *   {"type":"token","data":"..."}
 *   {"type":"done","data":{}}
 *   {"type":"error","data":{"message":"..."}}
 */

import { NextRequest } from 'next/server'
import { withApiKey } from '@/lib/api-key-middleware'
import { createV1QaChatStream } from '@/lib/qa-chat-engine'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  // 1. API 키 검증
  const auth = await withApiKey(request, { requiredScopes: ['qa:chat', 'qa:*'] })
  if (!auth.valid) return auth.response

  // 2. 요청 바디 파싱
  let body: { message?: string; history?: { role: string; content: string }[]; session_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { ok: false, error: { code: 'INVALID_JSON', message: 'JSON 형식이 올바르지 않습니다' } },
      { status: 400 },
    )
  }

  if (!body.message?.trim()) {
    return Response.json(
      { ok: false, error: { code: 'MISSING_MESSAGE', message: 'message 필드는 필수입니다' } },
      { status: 400 },
    )
  }

  // 3. V1 QA 채팅 스트림 호출 (tenant_id 전달)
  const stream = await createV1QaChatStream({
    message: body.message,
    history: body.history ?? [],
    sessionId: body.session_id ?? null,
    referrer: null,
    affiliateRef: null,
    affiliateId: auth.tenantId,
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
