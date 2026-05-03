/**
 * Jarvis Context 추출 — tenant / user / role 은 Supabase JWT 에서만 주입.
 * (요청 헤더·바디로 tenantId·userId·userRole 을 덮어쓰면 멀티테넌트 스푸핑 가능)
 */

import type { NextRequest } from 'next/server';
import type { JarvisContext } from './types';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    const decoded =
      typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('utf-8');
    const payload = JSON.parse(decoded);
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractFromJwt(req: NextRequest): Partial<JarvisContext> {
  const token = req.cookies.get('sb-access-token')?.value;
  if (!token) return {};
  const payload = decodeJwtPayload(token);
  if (!payload) return {};

  const appMeta = (payload.app_metadata ?? {}) as Record<string, unknown>;
  const userMeta = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const tenantId = appMeta.tenant_id ?? userMeta.tenant_id;
  const rawRole = appMeta.jarvis_role ?? appMeta.role ?? userMeta.jarvis_role;

  const knownRoles = ['platform_admin', 'tenant_admin', 'tenant_staff', 'customer'] as const;
  const userRole = (knownRoles as readonly string[]).includes(rawRole as string)
    ? (rawRole as JarvisContext['userRole'])
    : undefined;

  return {
    tenantId: typeof tenantId === 'string' ? tenantId : undefined,
    userId: typeof payload.sub === 'string' ? payload.sub : undefined,
    userRole,
  };
}

export function resolveJarvisContext(req: NextRequest, body?: { context?: Record<string, unknown> }): JarvisContext {
  const fromBody = (body?.context ?? {}) as Record<string, unknown>;
  const fromJwt = extractFromJwt(req);

  const knownSurfaces = ['admin', 'customer', 'api'] as const;
  const surfaceRaw = typeof fromBody.surface === 'string' ? fromBody.surface : 'admin';
  const surfaceSafe = (knownSurfaces as readonly string[]).includes(surfaceRaw)
    ? (surfaceRaw as JarvisContext['surface'])
    : 'admin';

  const blocked = ['tenantId', 'userId', 'userRole', 'surface'] as const;
  const safeBody = { ...fromBody };
  for (const k of blocked) delete safeBody[k];

  return {
    ...(safeBody as Partial<JarvisContext>),
    tenantId: fromJwt.tenantId,
    userId: fromJwt.userId,
    userRole: fromJwt.userRole,
    surface: surfaceSafe,
  };
}
