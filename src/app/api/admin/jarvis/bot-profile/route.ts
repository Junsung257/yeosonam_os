/**
 * 여소남 OS — Tenant Bot Profile Admin API (Phase 5 §B.4.4)
 *
 * GET  /api/admin/jarvis/bot-profile?tenantId=<uuid>
 * PUT  /api/admin/jarvis/bot-profile  { tenantId, ...partial profile }
 *
 * 인증:
 *   - 플랫폼 관리자 또는 자기 테넌트 조회/편집만 허용
 *   - x-user-role 헤더 + x-tenant-id 로 권한 체크 (middleware 에서 검증됐다고 가정)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { invalidatePersonaCache } from '@/lib/jarvis/persona'
import { validateRequest, UuidSchema } from '@/lib/api-validation'

const BotProfilePutSchema = z.object({
  tenantId: UuidSchema,
  bot_name: z.string().min(1).max(100).optional(),
  greeting: z.string().max(2000).optional(),
  persona_prompt: z.string().max(20000).optional(),
  allowed_agents: z.array(z.string()).optional(),
  allowed_tools: z.array(z.string()).optional(),
  knowledge_scope: z.record(z.unknown()).optional(),
  guardrails: z.record(z.unknown()).optional(),
  branding: z.record(z.unknown()).optional(),
  monthly_token_quota: z.number().int().min(0).optional(),
  rate_limit_per_min: z.number().int().min(0).max(10000).optional(),
  is_active: z.boolean().optional(),
})

function resolveScope(req: NextRequest) {
  const role = req.headers.get('x-user-role') ?? 'anonymous'
  const callerTenantId = req.headers.get('x-tenant-id') ?? null
  return { role, callerTenantId }
}

function authorize(req: NextRequest, targetTenantId: string | null) {
  const { role, callerTenantId } = resolveScope(req)
  if (role === 'platform_admin') return true
  if (role === 'tenant_admin' && callerTenantId && callerTenantId === targetTenantId) return true
  return false
}

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId 필요' }, { status: 400 })

  if (!authorize(req, tenantId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('tenant_bot_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}

export async function PUT(req: NextRequest) {
  const validation = await validateRequest(req, BotProfilePutSchema)
  if (!validation.success) return validation.response
  const { tenantId, ...patch } = validation.data

  if (!authorize(req, tenantId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const updates: Record<string, any> = { ...patch, updated_at: new Date().toISOString() }

  const { data: existing } = await supabaseAdmin
    .from('tenant_bot_profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  let result
  if (existing) {
    result = await supabaseAdmin
      .from('tenant_bot_profiles')
      .update(updates)
      .eq('tenant_id', tenantId)
      .select()
      .single()
  } else {
    result = await supabaseAdmin
      .from('tenant_bot_profiles')
      .insert({ tenant_id: tenantId, bot_name: updates.bot_name ?? '자비스', ...updates })
      .select()
      .single()
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })

  // 메모리 캐시 무효화 — 즉시 반영
  invalidatePersonaCache(tenantId)

  return NextResponse.json({ profile: result.data })
}
