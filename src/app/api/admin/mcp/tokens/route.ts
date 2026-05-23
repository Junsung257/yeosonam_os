/**
 * 여소남 OS — MCP API 키 관리 API
 *
 * GET  /api/admin/mcp/tokens — 키 목록 조회
 * POST /api/admin/mcp/tokens — 새 키 생성
 * DELETE /api/admin/mcp/tokens?id=xxx — 키 비활성화
 *
 * 키는 tenant_tokens 테이블을 사용하지만,
 * MCP 전용으로 provider='mcp' 인 레코드를 사용.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { invalidateMcpAuthCache } from '@/lib/jarvis/mcp-server'
import { createHash, randomBytes } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** MCP API 키 생성 (sk-mcp- 접두사 + 32바이트 랜덤 hex) */
function generateMcpKey(): string {
  const raw = randomBytes(32).toString('hex')
  return `sk-mcp-${raw}`
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** 인증 미들웨어 */
async function requireAdmin(request: NextRequest) {
  const { data: { user } } = await supabaseAdmin.auth.getUser(
    request.headers.get('Authorization')?.replace('Bearer ', '') ?? '',
  )
  if (!user) {
    return null
  }
  // platform_admin 확인
  const { data: profile } = await supabaseAdmin
    .from('staff_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'platform_admin') {
    return null
  }
  return user
}

export async function GET(request: NextRequest) {
  const user = await requireAdmin(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('tenant_tokens')
    .select('id, label, token_prefix, role, is_active, last_used_at, created_at')
    .eq('provider', 'mcp')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ tokens: data ?? [] })
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { label, role } = await request.json()
  if (!label) {
    return NextResponse.json({ error: 'label 필드 필요' }, { status: 400 })
  }

  const validRoles = ['tenant_staff', 'tenant_admin', 'platform_admin']
  if (role && !validRoles.includes(role)) {
    return NextResponse.json({ error: `role 은 ${validRoles.join(', ')} 중 하나` }, { status: 400 })
  }

  const rawKey = generateMcpKey()
  const keyHash = hashKey(rawKey)
  const prefix = rawKey.substring(0, 12) // sk-mcp-XXXXXX...

  const { data, error } = await supabaseAdmin
    .from('tenant_tokens')
    .insert({
      provider: 'mcp',
      label,
      token_prefix: prefix,
      access_token: keyHash, // SHA-256 해시만 저장 (원본은 반환 후 폐기)
      role: role ?? 'tenant_staff',
      is_active: true,
      scopes: [],
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    id: data.id,
    token: rawKey, // 최초 1회만 반환
    label,
    role: role ?? 'tenant_staff',
  })
}

export async function DELETE(request: NextRequest) {
  const user = await requireAdmin(request)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = request.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id 파라미터 필요' }, { status: 400 })
  }

  // 완전 삭제 대신 비활성화
  const { error } = await supabaseAdmin
    .from('tenant_tokens')
    .update({ is_active: false })
    .eq('id', id)
    .eq('provider', 'mcp')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 캐시 무효화
  invalidateMcpAuthCache()

  return NextResponse.json({ success: true })
}
