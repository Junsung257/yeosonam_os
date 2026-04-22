/**
 * 여소남 OS — Tenant-Scoped Supabase Proxy (V2 §B.2.3)
 *
 * `.from(table)` 호출을 가로채 테넌트 컨텍스트를 자동 주입한다.
 * 애플리케이션 레벨 1차 방어선. DB 레벨 RLS (set_request_context + policy) 는 2차.
 *
 * 동작 규칙:
 *   platform_admin          → 모든 테이블 전역 쿼리 (자비스 내부/사장님 콘솔용)
 *   tenantId 없음 + STRICT  → TenantScopeError (명시적 거부)
 *   tenantId 없음 + NULLABLE→ WHERE tenant_id IS NULL (여소남 본사 데이터만)
 *   tenantId 있음 + STRICT  → WHERE tenant_id = ctx.tenantId
 *   tenantId 있음 + NULLABLE→ WHERE tenant_id = ctx.tenantId OR tenant_id IS NULL
 *   GLOBAL / 미등록         → 필터 없음 (통과)
 *
 * 주의:
 * - Proxy 는 `.from()` 메서드만 가로챈다. 다른 메서드(rpc, storage 등)는 그대로 통과.
 * - `.insert()` 할 때는 자동 주입하지 않음 — 호출자가 명시적으로 `tenant_id: ctx.tenantId` 지정할 것.
 *   (자동 주입은 `update`/`upsert` 와의 충돌이 위험해서 policy 로만 강제)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'
import { TENANT_SCOPED_TABLES, classifyTable } from './scoped-tables'
import type { JarvisContext } from './types'

export class TenantScopeError extends Error {
  constructor(message: string, public table?: string) {
    super(message)
    this.name = 'TenantScopeError'
  }
}

/**
 * ctx 기반으로 필터가 자동 주입되는 클라이언트 반환.
 * ctx.userRole === 'platform_admin' 이면 원본 supabaseAdmin 그대로 반환 (오버헤드 0).
 * 그 외에는 Proxy 로 감싼 클라이언트 반환.
 */
export function getScopedClient(ctx: JarvisContext): SupabaseClient {
  // 플랫폼 관리자는 scoping 면제
  if (ctx.userRole === 'platform_admin') return supabaseAdmin

  // 미지정 컨텍스트 — legacy 경로 (기존 코드 호환). GLOBAL 테이블 외엔 STRICT 에서 막힘.
  const tenantId = ctx.tenantId

  return new Proxy(supabaseAdmin, {
    get(target, prop, receiver) {
      if (prop !== 'from') return Reflect.get(target, prop, receiver)
      return (table: string) => {
        const query: any = target.from(table)
        const kind = classifyTable(table)

        if (kind === 'STRICT') {
          if (!tenantId) {
            throw new TenantScopeError(
              `tenant_id required to query "${table}" (STRICT)`,
              table,
            )
          }
          return query.eq('tenant_id', tenantId)
        }

        if (kind === 'NULLABLE') {
          if (!tenantId) return query.is('tenant_id', null)
          return query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        }

        // GLOBAL 또는 UNREGISTERED — 통과
        if (kind === 'UNREGISTERED' && process.env.NODE_ENV !== 'production') {
          console.warn(
            `[scoped-client] "${table}" 이 scoped-tables 카탈로그에 없습니다. ` +
            `등록하지 않으면 격리가 적용되지 않습니다.`,
          )
        }
        return query
      }
    },
  }) as SupabaseClient
}

/**
 * 기존 코드에서 ctx 없이 호출되는 걸 점진적으로 마이그레이션하기 위한 no-op wrapper.
 * `ctx === undefined` 면 원본 supabaseAdmin 반환 → 동작 변경 없음.
 * Phase 3b/3c 에서 호출부에 ctx 를 전달하게 되면 자동으로 scoping 활성화.
 */
export function scopedOrAdmin(ctx?: JarvisContext): SupabaseClient {
  if (!ctx) return supabaseAdmin
  return getScopedClient(ctx)
}

/**
 * 요청 시작 시 Supabase 세션에 app.tenant_id / app.user_role 을 설정.
 * RLS 정책이 current_setting('app.tenant_id') 를 참조해 격리하도록 만든다.
 *
 * 주의: 이 호출은 매 요청마다 필요 (Supabase 커넥션 풀링 때문에 세션 상태 불확실).
 *       SET LOCAL 을 RPC 로 감싸서 트랜잭션 범위로 제한할 것.
 */
export async function applyRequestContext(ctx: JarvisContext): Promise<void> {
  if (process.env.JARVIS_RLS_ENABLED !== 'true') return // Phase 3d 이전에는 비활성

  try {
    await supabaseAdmin.rpc('set_jarvis_request_context', {
      p_tenant_id: ctx.tenantId ?? null,
      p_user_role: ctx.userRole ?? 'tenant_staff',
      p_user_id: ctx.userId ?? null,
    })
  } catch (err) {
    console.warn('[scoped-client] set_jarvis_request_context 실패:', err)
    // fail-open — 애플리케이션 Proxy 가 1차 방어선이므로 RLS 실패해도 서비스는 동작
  }
}
