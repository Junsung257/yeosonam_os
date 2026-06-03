/**
 * API key middleware for /api/v1/* routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyApiKey, trackApiUsage } from '@/lib/api-key-service'
import { apiResponse } from '@/lib/api-response'

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
  requiredScopes?: string[]
  skipTracking?: boolean
}

function rejectedApiKeyResponse(
  code: 'UNAUTHORIZED' | 'FORBIDDEN',
  message: string,
  status: 401 | 403,
): NextResponse {
  const response = apiResponse(
    {
      ok: false,
      error: { code, message },
    },
    { status },
  )
  response.headers.set('Cache-Control', 'no-store')
  return response
}

/**
 * Verifies the API key, checks scopes, and returns the tenant context.
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
      response: rejectedApiKeyResponse(
        'UNAUTHORIZED',
        verification.reason ?? 'API 키가 유효하지 않습니다',
        401,
      ),
    }
  }

  if (options.requiredScopes && options.requiredScopes.length > 0) {
    const userScopes = new Set(verification.scopes ?? [])
    const hasAnyScope = options.requiredScopes.some((scope) => userScopes.has(scope))

    if (!hasAnyScope) {
      return {
        valid: false,
        response: rejectedApiKeyResponse(
          'FORBIDDEN',
          `필요한 스코프: ${options.requiredScopes.join(', ')}`,
          403,
        ),
      }
    }
  }

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
