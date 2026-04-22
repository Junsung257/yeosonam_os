/**
 * 여소남 OS — Jarvis 사용량 대시보드 API (Phase 5)
 *
 * GET /api/admin/jarvis/usage?tenantId=<uuid>
 *   → 현재 달 사용량 + 봇 프로파일의 quota
 *
 * GET /api/admin/jarvis/usage?tenantId=<uuid>&months=6
 *   → 최근 N 개월 월별 집계
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getMonthlyUsage } from '@/lib/jarvis/cost-tracker'

function authorize(req: NextRequest, tenantId: string | null) {
  const role = req.headers.get('x-user-role') ?? 'anonymous'
  const callerTenantId = req.headers.get('x-tenant-id') ?? null
  if (role === 'platform_admin') return true
  if (role === 'tenant_admin' && callerTenantId && callerTenantId === tenantId) return true
  return false
}

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  const monthsParam = req.nextUrl.searchParams.get('months')
  if (!tenantId) return NextResponse.json({ error: 'tenantId 필요' }, { status: 400 })
  if (!authorize(req, tenantId)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // 1) 이번 달 현재 사용량
  const current = await getMonthlyUsage(tenantId)

  // 2) 프로파일의 쿼터
  const { data: profile } = await supabaseAdmin
    .from('tenant_bot_profiles')
    .select('monthly_token_quota, rate_limit_per_min')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const result: any = {
    current: {
      ...current,
      quotaTokens: profile?.monthly_token_quota ?? null,
      quotaUsedPct: profile?.monthly_token_quota
        ? Math.min(100, Math.round((current.totalTokens / profile.monthly_token_quota) * 100))
        : null,
    },
  }

  // 3) 월별 히스토리 (선택)
  if (monthsParam) {
    const months = Math.max(1, Math.min(24, parseInt(monthsParam, 10) || 6))
    const { data: history } = await supabaseAdmin
      .from('jarvis_monthly_usage')
      .select('month, total_tokens, total_cost_usd, call_count, avg_latency_ms')
      .eq('tenant_id', tenantId)
      .order('month', { ascending: false })
      .limit(months)
    result.history = history ?? []
  }

  return NextResponse.json(result)
}
