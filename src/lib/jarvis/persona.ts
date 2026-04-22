/**
 * 여소남 OS — Tenant Persona Builder (V2 §B.4.2)
 *
 * 테넌트 봇 프로파일을 읽어 base system prompt 뒤에 페르소나/가드레일을 append.
 * 결과 프롬프트는 agent loop 의 systemInstruction (또는 cachedContents) 에 주입.
 *
 * 캐싱:
 *   - 같은 프로세스 내 메모리 캐시 60초 (테넌트 수가 적을 때 유효)
 *   - 봇 프로파일 변경 즉시 반영해야 하면 invalidatePersonaCache() 호출
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { JarvisContext } from './types'

interface BotProfile {
  bot_name: string
  greeting: string | null
  persona_prompt: string | null
  allowed_agents: string[]
  guardrails: {
    max_discount_pct?: number
    forbidden_phrases?: string[]
    require_hitl_for?: string[]
  }
  monthly_token_quota: number
  is_active: boolean
}

interface CacheRec { profile: BotProfile | null; expiresAt: number }
const cache = new Map<string, CacheRec>()
const TTL_MS = 60_000

async function fetchProfile(tenantId: string): Promise<BotProfile | null> {
  const now = Date.now()
  const cached = cache.get(tenantId)
  if (cached && cached.expiresAt > now) return cached.profile

  const { data, error } = await supabaseAdmin
    .from('tenant_bot_profiles')
    .select('bot_name, greeting, persona_prompt, allowed_agents, guardrails, monthly_token_quota, is_active')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.warn('[persona] fetchProfile 오류:', error.message)
    return null
  }

  cache.set(tenantId, { profile: (data as BotProfile) ?? null, expiresAt: now + TTL_MS })
  return (data as BotProfile) ?? null
}

export function invalidatePersonaCache(tenantId?: string) {
  if (tenantId) cache.delete(tenantId)
  else cache.clear()
}

/**
 * base system prompt 에 테넌트 페르소나 + 가드레일을 append.
 * tenantId 가 없거나 프로파일 없으면 base 를 그대로 반환 (여소남 본사 기본 동작).
 */
export async function buildTenantSystemPrompt(
  basePrompt: string,
  ctx: JarvisContext,
): Promise<string> {
  if (!ctx.tenantId || ctx.userRole === 'platform_admin') return basePrompt

  const profile = await fetchProfile(ctx.tenantId)
  if (!profile) return basePrompt

  const sections: string[] = [basePrompt, '', '## 테넌트 페르소나', `당신의 이름은 "${profile.bot_name}" 입니다.`]

  if (profile.persona_prompt) {
    sections.push(profile.persona_prompt)
  }
  if (profile.greeting) {
    sections.push(`첫 대화 시 아래 인사말로 시작: "${profile.greeting}"`)
  }

  // ─── 가드레일 ───
  const gr = profile.guardrails ?? {}
  const guardrailLines: string[] = []
  if (typeof gr.max_discount_pct === 'number' && gr.max_discount_pct > 0) {
    guardrailLines.push(`- 할인 약속은 **${gr.max_discount_pct}% 이하** 로 제한. 초과 요청은 "담당자 확인 후 안내드리겠습니다".`)
  } else {
    guardrailLines.push('- 할인·가격 조정 약속 금지. 문의는 담당자 에스컬레이션.')
  }
  if (Array.isArray(gr.forbidden_phrases) && gr.forbidden_phrases.length > 0) {
    guardrailLines.push(`- 금지 표현: ${gr.forbidden_phrases.map(p => `"${p}"`).join(', ')}`)
  }
  if (Array.isArray(gr.require_hitl_for) && gr.require_hitl_for.length > 0) {
    guardrailLines.push(`- 다음 주제는 자동 응답 대신 담당자 에스컬레이션: ${gr.require_hitl_for.join(', ')}`)
  }

  if (guardrailLines.length > 0) {
    sections.push('', '## 테넌트 가드레일', ...guardrailLines)
  }

  return sections.join('\n')
}

/** 테넌트가 현재 agent 를 호출할 권한 있는지 체크 */
export async function isAgentAllowed(ctx: JarvisContext, agentType: string): Promise<boolean> {
  if (!ctx.tenantId || ctx.userRole === 'platform_admin') return true
  const profile = await fetchProfile(ctx.tenantId)
  if (!profile) return true // 프로파일 없으면 기본 허용 (첫 가입 테넌트)
  return profile.allowed_agents.includes(agentType)
}

/** 현재 봇 이름 가져오기 (UI 타이틀 등) */
export async function getBotName(ctx: JarvisContext): Promise<string> {
  if (!ctx.tenantId) return '자비스'
  const profile = await fetchProfile(ctx.tenantId)
  return profile?.bot_name ?? '자비스'
}
