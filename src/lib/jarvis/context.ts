/**
 * 여소남 OS — Jarvis Context 추출 헬퍼 (Phase 6)
 *
 * 우선순위 (낮 → 높):
 *   1) request body.context
 *   2) 명시적 헤더 (x-tenant-id, x-user-id, x-user-role, x-surface)
 *   3) Supabase 쿠키 JWT 의 claim (app_metadata / sub)
 *
 * Supabase JWT 에 tenant_id / role 이 포함되어 있어야 자동 주입 가능.
 * 없으면 헤더·body 로 명시적으로 넘겨야 함.
 *
 * /api/jarvis/route.ts 와 /api/jarvis/stream/route.ts 가 공통 사용.
 */

import type { NextRequest } from 'next/server'
import type { JarvisContext } from './types'

/** Base64url → JSON (안전 디코딩) */
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    // base64url → base64
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '==='.slice((b64.length + 3) % 4)
    const decoded = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf-8')
    const payload = JSON.parse(decoded)
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

function extractFromJwt(req: NextRequest): Partial<JarvisContext> {
  const token = req.cookies.get('sb-access-token')?.value
  if (!token) return {}
  const payload = decodeJwtPayload(token)
  if (!payload) return {}

  // Supabase 는 tenant_id 를 app_metadata / user_metadata 에 커스텀으로 넣을 수 있다.
  const appMeta = payload.app_metadata ?? {}
  const userMeta = payload.user_metadata ?? {}
  const tenantId = appMeta.tenant_id ?? userMeta.tenant_id
  const rawRole = appMeta.jarvis_role ?? appMeta.role ?? userMeta.jarvis_role

  // role 정규화 — 알려진 값만 수용 (prototype pollution 방지)
  const knownRoles = ['platform_admin', 'tenant_admin', 'tenant_staff', 'customer'] as const
  const userRole = (knownRoles as readonly string[]).includes(rawRole) ? rawRole as any : undefined

  return {
    tenantId: typeof tenantId === 'string' ? tenantId : undefined,
    userId: typeof payload.sub === 'string' ? payload.sub : undefined,
    userRole,
  }
}

export function resolveJarvisContext(req: NextRequest, body?: any): JarvisContext {
  const h = req.headers
  const fromBody = (body?.context ?? {}) as Record<string, any>
  const fromJwt = extractFromJwt(req)

  const knownRoles = ['platform_admin', 'tenant_admin', 'tenant_staff', 'customer'] as const
  const headerRole = h.get('x-user-role') ?? undefined
  const headerRoleSafe = (knownRoles as readonly string[]).includes(headerRole ?? '')
    ? headerRole as JarvisContext['userRole']
    : undefined

  const knownSurfaces = ['admin', 'customer', 'api'] as const
  const headerSurface = h.get('x-surface') ?? fromBody.surface ?? 'admin'
  const surfaceSafe = (knownSurfaces as readonly string[]).includes(headerSurface)
    ? headerSurface as JarvisContext['surface']
    : 'admin'

  return {
    ...fromBody,
    tenantId: h.get('x-tenant-id') ?? fromBody.tenantId ?? fromJwt.tenantId ?? undefined,
    userId:   h.get('x-user-id')   ?? fromBody.userId   ?? fromJwt.userId   ?? undefined,
    userRole: headerRoleSafe ?? fromBody.userRole ?? fromJwt.userRole ?? undefined,
    surface:  surfaceSafe,
  }
}
