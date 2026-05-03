/**
 * 여소남 OS — Jarvis V2 Cost Tracker (V2 §B.4.3)
 *
 * Gemini usageMetadata / DeepSeek OpenAI usage 를 jarvis_cost_ledger 에 기록하고,
 * 월간 쿼터 초과 시 QuotaExceededError 로 요청 차단.
 *
 * 단가 ($/1M tokens — 실제 청구는 각 공급사 인보이스 기준):
 *
 *   [Gemini — 2026-02 기준]
 *   gemini-2.5-pro        : input $1.25  · output $10.00 · cache_read $0.31
 *   gemini-2.5-flash      : input $0.075 · output $0.30  · cache_read $0.019
 *   gemini-2.5-flash-lite : input $0.04  · output $0.15  · cache_read $0.01
 *   gemini-embedding-001  : input $0.025 · output 0
 *
 *   [DeepSeek V4 — 2026-05 추정값, 실제 청구와 다를 수 있음]
 *   deepseek-v4-flash     : input $0.014 · output $0.028 · cache_read $0.0014
 *   deepseek-v4-pro       : input $0.14  · output $0.28  · cache_read $0.014
 *
 * 단가 변경 시 PRICING / DEEPSEEK_PRICING 표만 갱신.
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { JarvisContext } from './types'

type PricePair = { input: number; output: number; cacheRead: number }

// $/1M tokens — Gemini
const PRICING: Record<string, PricePair> = {
  'gemini-2.5-pro':        { input: 1.25,  output: 10.00, cacheRead: 0.31  },
  'gemini-2.5-flash':      { input: 0.075, output: 0.30,  cacheRead: 0.019 },
  'gemini-2.5-flash-lite': { input: 0.04,  output: 0.15,  cacheRead: 0.01  },
  'gemini-2.0-flash':      { input: 0.075, output: 0.30,  cacheRead: 0.019 },
  'gemini-embedding-001':  { input: 0.025, output: 0,     cacheRead: 0     },
}

// $/1M tokens — DeepSeek V4 (추정값)
const DEEPSEEK_PRICING: Record<string, PricePair> = {
  'deepseek-v4-flash': { input: 0.014, output: 0.028, cacheRead: 0.0014 },
  'deepseek-v4-pro':   { input: 0.14,  output: 0.28,  cacheRead: 0.014  },
}

export interface GeminiUsage {
  promptTokenCount?: number           // input
  candidatesTokenCount?: number       // output
  cachedContentTokenCount?: number    // cache read
  thoughtsTokenCount?: number         // thinking (2.5 only)
  totalTokenCount?: number
}

export interface TrackCostParams {
  ctx: JarvisContext
  sessionId?: string
  agentType: string
  model: string
  usage: GeminiUsage
  latencyMs?: number
}

export class QuotaExceededError extends Error {
  constructor(public tenantId: string, public used: number, public quota: number) {
    super(`월 토큰 쿼터 초과: ${used.toLocaleString()} / ${quota.toLocaleString()}`)
    this.name = 'QuotaExceededError'
  }
}

/**
 * 단가 계산. 모델을 찾지 못하면 flash 단가로 폴백 (과소청구 방지).
 */
export function computeCostUsd(model: string, usage: GeminiUsage): number {
  const price = PRICING[model] ?? PRICING['gemini-2.5-flash']
  const input = usage.promptTokenCount ?? 0
  const output = usage.candidatesTokenCount ?? 0
  const cacheRead = usage.cachedContentTokenCount ?? 0
  const thinking = usage.thoughtsTokenCount ?? 0

  // cache 에서 읽은 토큰은 cacheRead 단가로, 그 외 input 은 정상 단가
  const chargedInput = Math.max(0, input - cacheRead)
  return (
    (chargedInput * price.input) +
    (cacheRead    * price.cacheRead) +
    ((output + thinking) * price.output)
  ) / 1_000_000
}

/** jarvis_cost_ledger 에 한 줄 기록. 실패해도 서비스 차단 안 함 (fail-open). */
export async function trackCost(p: TrackCostParams): Promise<void> {
  try {
    const cost = computeCostUsd(p.model, p.usage)
    await supabaseAdmin.from('jarvis_cost_ledger').insert({
      tenant_id: p.ctx.tenantId ?? null,
      session_id: p.sessionId ?? null,
      agent_type: p.agentType,
      model: p.model,
      input_tokens: p.usage.promptTokenCount ?? 0,
      output_tokens: p.usage.candidatesTokenCount ?? 0,
      cache_read_tokens: p.usage.cachedContentTokenCount ?? 0,
      thinking_tokens: p.usage.thoughtsTokenCount ?? 0,
      cost_usd: cost,
      latency_ms: p.latencyMs ?? null,
    })
  } catch (err) {
    console.warn('[cost-tracker] 기록 실패:', err)
  }
}

/**
 * 월 쿼터 체크. 초과 시 QuotaExceededError.
 * platform_admin 및 tenantId 없는 요청은 체크 건너뜀.
 */
export async function assertQuota(ctx: JarvisContext): Promise<void> {
  if (!ctx.tenantId || ctx.userRole === 'platform_admin') return

  const [{ data: usage }, { data: profile }] = await Promise.all([
    supabaseAdmin.rpc('jarvis_current_month_usage', { p_tenant_id: ctx.tenantId }),
    supabaseAdmin
      .from('tenant_bot_profiles')
      .select('monthly_token_quota')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle(),
  ])

  const used = Number((usage as any)?.[0]?.total_tokens ?? 0)
  const quota = Number(profile?.monthly_token_quota ?? Number.POSITIVE_INFINITY)

  if (used >= quota) {
    throw new QuotaExceededError(ctx.tenantId, used, quota)
  }
}

/** 관리자 UI 에서 사용 — 현재 사용량 조회 */
export async function getMonthlyUsage(tenantId: string) {
  const { data } = await supabaseAdmin.rpc('jarvis_current_month_usage', { p_tenant_id: tenantId })
  const row = (data as any)?.[0] ?? {}
  return {
    totalTokens: Number(row.total_tokens ?? 0),
    totalCostUsd: Number(row.total_cost_usd ?? 0),
    callCount: Number(row.call_count ?? 0),
  }
}

// ─── DeepSeek 비용 추적 ───────────────────────────────────────────────────────

export interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** DeepSeek 프롬프트 캐시 히트 토큰 (OpenAI usage 확장 필드) */
  prompt_cache_hit_tokens?: number;
}

export interface TrackDeepSeekCostParams {
  task: string;
  model: string;
  usage: DeepSeekUsage;
  latencyMs?: number;
}

/** DeepSeek API 호출 비용을 jarvis_cost_ledger 에 기록. 실패해도 서비스 차단 안 함 (fail-open). */
export async function trackDeepSeekCost(p: TrackDeepSeekCostParams): Promise<void> {
  try {
    const price = DEEPSEEK_PRICING[p.model] ?? DEEPSEEK_PRICING['deepseek-v4-flash']
    const input = p.usage.prompt_tokens ?? 0
    const output = p.usage.completion_tokens ?? 0
    const cacheHit = p.usage.prompt_cache_hit_tokens ?? 0
    const chargedInput = Math.max(0, input - cacheHit)
    const cost = (
      (chargedInput * price.input) +
      (cacheHit    * price.cacheRead) +
      (output      * price.output)
    ) / 1_000_000

    await supabaseAdmin.from('jarvis_cost_ledger').insert({
      tenant_id: null,
      session_id: null,
      agent_type: p.task,
      model: p.model,
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheHit,
      cache_write_tokens: 0,
      thinking_tokens: 0,
      cost_usd: cost,
      latency_ms: p.latencyMs ?? null,
    })
  } catch (err) {
    console.warn('[cost-tracker] DeepSeek 기록 실패:', err)
  }
}
