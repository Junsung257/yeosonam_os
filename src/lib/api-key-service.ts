/**
 * 여소남 OS — API 키 발급/검증 서비스 (Phase 3-1)
 *
 * 기능:
 *   - API 키 발급 (sha256 해시 저장)
 *   - API 키 검증 (Authorization 헤더 → tenant 식별)
 *   - 사용량 측정 + 월간 쿼터 체크
 *
 * 사용:
 *   import { createApiKey, verifyApiKey, trackApiUsage } from '@/lib/api-key-service'
 *
 *   // 키 발급 (관리자 전용)
 *   const { key, record } = await createApiKey({
 *     tenantId: '...',
 *     name: '프로덕션',
 *     scopes: ['qa:chat', 'qa:read'],
 *   })
 *
 *   // 미들웨어에서 검증
 *   const result = await verifyApiKey(request.headers.get('Authorization'))
 *   if (!result.valid) return new Response('Unauthorized', { status: 401 })
 *
 *   // 사용량 추적
 *   await trackApiUsage({ apiKeyId: result.apiKeyId!, endpoint: '/api/qa/chat' })
 */

import crypto from 'node:crypto'
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase'
import { sanitizeDbError } from '@/lib/error-sanitizer'

const KEY_PREFIX = 'ysn_'
const KEY_BYTE_LENGTH = 32 // 256-bit

// ─── 키 생성 ────────────────────────────────────────────────────────────

export interface CreateApiKeyParams {
  tenantId: string
  name: string
  scopes?: string[]
  rateLimitPerMin?: number
  monthlyQuota?: number
  expiresAt?: string
}

export interface CreateApiKeyResult {
  /** 전체 키 (한 번만 노출) */
  key: string
  /** DB 레코드 */
  record: {
    id: string
    keyPrefix: string
    name: string
    scopes: string[]
  }
}

/**
 * 새 API 키를 발급한다.
 * @returns `key` (전체 키 — 호출자에게 한 번만 노출) + DB record
 */
export async function createApiKey(params: CreateApiKeyParams): Promise<CreateApiKeyResult | null> {
  if (!isSupabaseConfigured) return null

  const secret = crypto.randomBytes(KEY_BYTE_LENGTH).toString('hex')
  const keyPrefix = `${KEY_PREFIX}${Date.now().toString(36).slice(-4)}_`
  const fullKey = `${keyPrefix}${secret}`
  const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex')

  const monthlyQuota = params.monthlyQuota ?? null
  const now = new Date()
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  try {
    const { data, error } = await supabaseAdmin
      .from('api_keys')
      .insert({
        tenant_id: params.tenantId,
        name: params.name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scopes: params.scopes ?? [],
        rate_limit_per_min: params.rateLimitPerMin ?? 60,
        monthly_quota: monthlyQuota,
        monthly_usage: 0,
        quota_reset_at: nextMonth.toISOString(),
        expires_at: params.expiresAt ?? null,
      })
      .select('id, key_prefix, name, scopes')
      .single()

    if (error) throw error
    if (!data) return null

    return {
      key: fullKey,
      record: {
        id: data.id,
        keyPrefix: data.key_prefix,
        name: data.name,
        scopes: data.scopes as string[],
      },
    }
  } catch (err) {
    console.warn('[api-key-service] 키 생성 실패:', sanitizeDbError(err))
    return null
  }
}

// ─── 검증 ────────────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean
  apiKeyId?: string
  tenantId?: string
  scopes?: string[]
  reason?: string
}

/**
 * Authorization 헤더에서 API 키를 추출하고 검증한다.
 * 지원 형식: "Bearer ysn_live_..." 또는 "ysn_live_..."
 */
export async function verifyApiKey(authHeader: string | null): Promise<VerifyResult> {
  if (!authHeader) return { valid: false, reason: 'Authorization 헤더 없음' }
  if (!isSupabaseConfigured) return { valid: false, reason: 'DB 미설정' }

  const key = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim()

  if (!key.startsWith(KEY_PREFIX)) {
    return { valid: false, reason: '유효하지 않은 키 형식' }
  }

  const keyHash = crypto.createHash('sha256').update(key).digest('hex')

  try {
    const { data, error } = await supabaseAdmin
      .from('api_keys')
      .select('id, tenant_id, scopes, is_active, expires_at, monthly_quota, monthly_usage, quota_reset_at')
      .eq('key_hash', keyHash)
      .maybeSingle()

    if (error) throw error
    if (!data) return { valid: false, reason: '키를 찾을 수 없음' }

    if (!data.is_active) return { valid: false, reason: '비활성화된 키' }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return { valid: false, reason: '만료된 키' }
    }

    // 월간 쿼터 체크
    if (data.monthly_quota) {
      const currentMonth = new Date()
      const resetMonth = data.quota_reset_at ? new Date(data.quota_reset_at) : null

      // quota_reset_at 이 지났으면 리셋
      if (resetMonth && currentMonth >= resetMonth) {
        await supabaseAdmin
          .from('api_keys')
          .update({ monthly_usage: 0, quota_reset_at: new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1).toISOString() })
          .eq('id', data.id)
      }

      const usage = resetMonth && currentMonth >= resetMonth ? 0 : (data.monthly_usage ?? 0)
      if (usage >= data.monthly_quota) {
        return { valid: false, reason: '월간 쿼터 초과' }
      }
    }

    // last_used_at 갱신 (비동기, 실패 무시)
    void supabaseAdmin
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)

    return {
      valid: true,
      apiKeyId: data.id,
      tenantId: data.tenant_id,
      scopes: data.scopes as string[],
    }
  } catch (err) {
    console.warn('[api-key-service] 키 검증 실패:', sanitizeDbError(err))
    return { valid: false, reason: '검증 중 오류' }
  }
}

// ─── 사용량 추적 ─────────────────────────────────────────────────────────

export interface TrackUsageParams {
  apiKeyId: string
  endpoint: string
  method?: string
  statusCode?: number
  latencyMs?: number
  ipAddress?: string
  userAgent?: string
}

/**
 * API 키 사용량을 기록하고 monthly_usage 를 증가시킨다.
 */
export async function trackApiUsage(params: TrackUsageParams): Promise<void> {
  if (!isSupabaseConfigured) return
  try {
    // 사용량 로그 기록
    await supabaseAdmin.from('api_key_usage').insert({
      api_key_id: params.apiKeyId,
      endpoint: params.endpoint,
      method: params.method ?? null,
      status_code: params.statusCode ?? null,
      latency_ms: params.latencyMs ?? null,
      ip_address: params.ipAddress ?? null,
      user_agent: params.userAgent ?? null,
    })

    // monthly_usage 증가
    await supabaseAdmin.rpc('increment_api_key_usage', {
      p_key_id: params.apiKeyId,
    })
  } catch (err) {
    console.warn('[api-key-service] 사용량 기록 실패:', sanitizeDbError(err))
  }
}

// ─── 키 관리 (어드민) ───────────────────────────────────────────────────

/**
 * 테넌트의 모든 API 키 목록을 조회한다.
 */
export async function listApiKeys(tenantId: string): Promise<Array<{
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  isActive: boolean
  lastUsedAt: string | null
  monthlyUsage: number
  monthlyQuota: number | null
  createdAt: string
}>> {
  if (!isSupabaseConfigured) return []
  try {
    const { data } = await supabaseAdmin
      .from('api_keys')
      .select('id, name, key_prefix, scopes, is_active, last_used_at, monthly_usage, monthly_quota, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    return ((data ?? []) as Array<{
      id: string
      name: string
      key_prefix: string
      scopes: string[]
      is_active: boolean
      last_used_at: string | null
      monthly_usage: number
      monthly_quota: number | null
      created_at: string
    }>).map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.key_prefix,
      scopes: r.scopes,
      isActive: r.is_active,
      lastUsedAt: r.last_used_at,
      monthlyUsage: r.monthly_usage,
      monthlyQuota: r.monthly_quota,
      createdAt: r.created_at,
    }))
  } catch (err) {
    console.warn('[api-key-service] 키 목록 조회 실패:', sanitizeDbError(err))
    return []
  }
}

/**
 * API 키를 활성화/비활성화한다.
 */
export async function toggleApiKey(params: {
  keyId: string
  isActive: boolean
}): Promise<boolean> {
  if (!isSupabaseConfigured) return false
  try {
    const { error } = await supabaseAdmin
      .from('api_keys')
      .update({ is_active: params.isActive })
      .eq('id', params.keyId)
    if (error) throw error
    return true
  } catch (err) {
    console.warn('[api-key-service] 키 상태 변경 실패:', sanitizeDbError(err))
    return false
  }
}

/**
 * API 키를 삭제한다.
 */
export async function deleteApiKey(keyId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false
  try {
    const { error } = await supabaseAdmin
      .from('api_keys')
      .delete()
      .eq('id', keyId)
    if (error) throw error
    return true
  } catch (err) {
    console.warn('[api-key-service] 키 삭제 실패:', sanitizeDbError(err))
    return false
  }
}
