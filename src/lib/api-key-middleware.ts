/**
 * 여소남 OS — 외부 REST API 키 미들웨어
 *
 * 모든 /api/v1/* 엔드포인트에 적용한다.
 * Authorization: Bearer <key> 헤더를 검증하고 tenant/scopes 를 context 에 설정한다.
 *
 * 사용:
 *   import { withApiKey } from '@/lib/api-key-middleware'
 *   import { verifyApiKey, trackApiUsage } from '@/lib/api-key-service'
 *
 *   export async function GET(request: NextRequest) {
 *     const auth = await withApiKey(request, { requiredScopes: ['qa:read'] })
 *     if (!auth.valid) return auth.response
 *     // auth.tenantId, auth.apiKeyId 사용 가능
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyApiKey, trackApiUsage } from '@/lib/api-key-service'
import { ApiErrors } from '@/lib/api-response'

export interface ApiKeyContext {
  valid: true
  tenantId: string
  apiKeyId: string
  scopes: string[]
  response?: never
}

export interface ApiKeyRejected {
  valid: false
  response: NextResponse
  tenantId?: never
  apiKeyId?: never
  scopes?: never
}

export type WithApiKeyResult = ApiKeyContext | ApiKeyRejected

export interface WithApiKeyOptions {
  /** 필요한 스코프 (하나라도 일치해야 통과) */
  requiredScopes?: string[]
  /** 사용량 추적 비활성화 */
  skipTracking?: boolean
}

/**
 * API 키를 검증하고 컨텍스트를 반환한다.
 *
 * Authorization 헤더에서 키 추출 → verifyApiKey → scope 체크 → 사용량 추적
 */
export async function withApiKey(
  request: NextRequest,
  options: WithApiKeyOptions = {},
): Promise<WithApiKeyResult> {
  const authHeader = request.headers.get('Authorization')
  const verification = await verifyApiKey(authHeader)

  if (!verification.valid) {
    return {
      valid: false,
      response: NextResponse.json(
        {
          ok: false,
          error: {
            code: 'UNAUTHORIZED',
            message: verification.reason ?? 'API 키가 유효하지 않습니다',
          },
        },
        { status: 401 },
      ),
    }
  }

  // scope 체크
  if (options.requiredScopes && options.requiredScopes.length > 0) {
    const userScopes = new Set(verification.scopes ?? [])
    const hasAnyScope = options.requiredScopes.some((s) => userScopes.has(s))
    if (!hasAnyScope) {
      return {
        valid: false,
        response: NextResponse.json(
          {
            ok: false,
            error: {
              code: 'FORBIDDEN',
              message: `필요한 스코프: ${options.requiredScopes.join(', ')}`,
            },
          },
          { status: 403 },
        ),
      }
    }
  }

  // 사용량 추적 (비동기, fail-open)
  if (!options.skipTracking && verification.apiKeyId) {
    void trackApiUsage({
      apiKeyId: verification.apiKeyId,
      endpoint: request.nextUrl.pathname,
      method: request.method,
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    })
  }

  return {
    valid: true,
    tenantId: verification.tenantId!,
    apiKeyId: verification.apiKeyId!,
    scopes: verification.scopes ?? [],
  }
}
