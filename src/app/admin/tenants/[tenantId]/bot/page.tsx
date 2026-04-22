'use client'

/**
 * 여소남 OS — Tenant Bot Profile 관리 (Phase 6 §B.4.4)
 *
 * /admin/tenants/[tenantId]/bot
 *
 * 기능:
 *   - 봇 이름·인사말·페르소나 프롬프트 편집
 *   - allowed_agents 체크박스
 *   - 가드레일 편집 (max_discount_pct, forbidden_phrases)
 *   - 월 토큰 쿼터 슬라이더
 *   - 이번 달 사용량 (토큰/비용/호출수/평균 레이턴시) + 쿼터 사용률 프로그레스 바
 *   - 최근 6개월 월별 히스토리
 */

import { useEffect, useState, use } from 'react'

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
  knowledge_scope: {
    include_shared?: boolean
    source_types?: string[]
  }
  monthly_token_quota: number
  rate_limit_per_min: number
  is_active: boolean
}

interface UsageData {
  current: {
    totalTokens: number
    totalCostUsd: number
    callCount: number
    quotaTokens: number | null
    quotaUsedPct: number | null
  }
  history?: Array<{
    month: string
    total_tokens: number
    total_cost_usd: number
    call_count: number
    avg_latency_ms: number
  }>
}

const AGENT_OPTIONS = ['concierge', 'operations', 'products', 'finance', 'marketing', 'sales', 'system']

export default function TenantBotProfilePage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = use(props.params)
  const [profile, setProfile] = useState<BotProfile | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/jarvis/bot-profile?tenantId=${tenantId}`).then(r => r.json()),
      fetch(`/api/admin/jarvis/usage?tenantId=${tenantId}&months=6`).then(r => r.json()),
    ]).then(([p, u]) => {
      setProfile(p.profile ?? createDefaultProfile())
      setUsage(u)
      setLoading(false)
    }).catch(err => {
      setMessage(`로드 실패: ${err.message}`)
      setLoading(false)
    })
  }, [tenantId])

  async function handleSave() {
    if (!profile) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/jarvis/bot-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ...profile }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setProfile(json.profile)
      setMessage('저장됨')
      setTimeout(() => setMessage(null), 3000)
    } catch (err: any) {
      setMessage(`저장 실패: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">로드 중...</div>
  if (!profile) return <div className="p-6 text-sm text-red-500">프로파일 로드 실패</div>

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">자비스 봇 설정</h1>
          <p className="text-sm text-gray-500 mt-1">테넌트 ID: <code>{tenantId}</code></p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </header>

      {message && (
        <div className="p-3 rounded bg-gray-100 text-sm">{message}</div>
      )}

      {/* ── 사용량 대시보드 ─────────────────────── */}
      <UsageCard usage={usage} quota={profile.monthly_token_quota} />

      {/* ── 기본 정보 ───────────────────────────── */}
      <Section title="기본 정보">
        <Field label="봇 이름">
          <input
            value={profile.bot_name}
            onChange={e => setProfile({ ...profile, bot_name: e.target.value })}
            className="w-full border rounded px-3 py-2"
            placeholder="예: ABC투어 여행 컨시어지"
          />
        </Field>
        <Field label="인사말">
          <input
            value={profile.greeting ?? ''}
            onChange={e => setProfile({ ...profile, greeting: e.target.value || null })}
            className="w-full border rounded px-3 py-2"
            placeholder="예: 안녕하세요! 오늘 어떤 여행을 계획하고 계신가요?"
          />
        </Field>
        <Field label="페르소나 프롬프트" hint="고유 페르소나·말투를 여기에. 기본 프롬프트 뒤에 append 됨.">
          <textarea
            value={profile.persona_prompt ?? ''}
            onChange={e => setProfile({ ...profile, persona_prompt: e.target.value || null })}
            rows={6}
            className="w-full border rounded px-3 py-2 font-mono text-sm"
            placeholder="예: 당신은 30년 경력 베테랑 가이드의 말투로 답합니다..."
          />
        </Field>
        <Field label="활성화">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={profile.is_active}
              onChange={e => setProfile({ ...profile, is_active: e.target.checked })}
            />
            <span className="text-sm">is_active</span>
          </label>
        </Field>
      </Section>

      {/* ── 권한 ────────────────────────────────── */}
      <Section title="권한 · 범위">
        <Field label="허용 Agent" hint="이 봇이 호출 가능한 에이전트 타입">
          <div className="flex flex-wrap gap-3">
            {AGENT_OPTIONS.map(a => (
              <label key={a} className="inline-flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={profile.allowed_agents.includes(a)}
                  onChange={e => {
                    const next = e.target.checked
                      ? [...profile.allowed_agents, a]
                      : profile.allowed_agents.filter(x => x !== a)
                    setProfile({ ...profile, allowed_agents: next })
                  }}
                />
                {a}
              </label>
            ))}
          </div>
        </Field>
        <Field label="공유 카탈로그 포함 (여소남 본사 상품/블로그)">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={profile.knowledge_scope?.include_shared ?? true}
              onChange={e => setProfile({
                ...profile,
                knowledge_scope: { ...profile.knowledge_scope, include_shared: e.target.checked },
              })}
            />
            include_shared
          </label>
        </Field>
      </Section>

      {/* ── 가드레일 ────────────────────────────── */}
      <Section title="가드레일">
        <Field label="최대 할인율 (%)" hint="0 = 할인 약속 전면 금지">
          <input
            type="number"
            min={0} max={50}
            value={profile.guardrails?.max_discount_pct ?? 0}
            onChange={e => setProfile({
              ...profile,
              guardrails: { ...profile.guardrails, max_discount_pct: Number(e.target.value) },
            })}
            className="w-24 border rounded px-3 py-2"
          />
        </Field>
        <Field label="금지 표현" hint="쉼표로 구분">
          <input
            value={(profile.guardrails?.forbidden_phrases ?? []).join(', ')}
            onChange={e => setProfile({
              ...profile,
              guardrails: {
                ...profile.guardrails,
                forbidden_phrases: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              },
            })}
            className="w-full border rounded px-3 py-2"
            placeholder="예: 매력적인, 완벽한, 놓치지 마세요"
          />
        </Field>
        <Field label="자동 응답 금지 주제 (HITL 필수)" hint="쉼표로 구분">
          <input
            value={(profile.guardrails?.require_hitl_for ?? []).join(', ')}
            onChange={e => setProfile({
              ...profile,
              guardrails: {
                ...profile.guardrails,
                require_hitl_for: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              },
            })}
            className="w-full border rounded px-3 py-2"
            placeholder="예: refund, custom_discount, complaint"
          />
        </Field>
      </Section>

      {/* ── 쿼터 ────────────────────────────────── */}
      <Section title="쿼터">
        <Field label={`월 토큰 쿼터: ${profile.monthly_token_quota.toLocaleString()}`}>
          <input
            type="range"
            min={100000}
            max={50000000}
            step={100000}
            value={profile.monthly_token_quota}
            onChange={e => setProfile({ ...profile, monthly_token_quota: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`분당 요청 제한: ${profile.rate_limit_per_min}/min`}>
          <input
            type="range"
            min={10}
            max={600}
            step={10}
            value={profile.rate_limit_per_min}
            onChange={e => setProfile({ ...profile, rate_limit_per_min: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
      </Section>

      {/* ── 월별 히스토리 ───────────────────────── */}
      {usage?.history && usage.history.length > 0 && (
        <Section title="월별 사용량 히스토리">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">월</th>
                <th className="text-right px-3 py-2">토큰</th>
                <th className="text-right px-3 py-2">비용 (USD)</th>
                <th className="text-right px-3 py-2">호출수</th>
                <th className="text-right px-3 py-2">평균 지연 (ms)</th>
              </tr>
            </thead>
            <tbody>
              {usage.history.map(h => (
                <tr key={h.month} className="border-t">
                  <td className="px-3 py-2">{new Date(h.month).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short' })}</td>
                  <td className="text-right px-3 py-2">{h.total_tokens.toLocaleString()}</td>
                  <td className="text-right px-3 py-2">${Number(h.total_cost_usd).toFixed(4)}</td>
                  <td className="text-right px-3 py-2">{h.call_count.toLocaleString()}</td>
                  <td className="text-right px-3 py-2">{h.avg_latency_ms.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  )
}

// ─── 보조 컴포넌트 ───────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border rounded-lg p-5 space-y-4 bg-white">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {children}
    </div>
  )
}

function UsageCard({ usage, quota }: { usage: UsageData | null; quota: number }) {
  if (!usage) return null
  const c = usage.current
  const pct = c.quotaUsedPct ?? Math.min(100, Math.round((c.totalTokens / quota) * 100))
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500'

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5 bg-gray-50 rounded-lg">
      <Stat label="이번 달 토큰" value={c.totalTokens.toLocaleString()} />
      <Stat label="이번 달 비용" value={`$${c.totalCostUsd.toFixed(4)}`} />
      <Stat label="호출 수" value={c.callCount.toLocaleString()} />
      <div className="col-span-2 md:col-span-1">
        <div className="text-xs text-gray-500">쿼터 사용률</div>
        <div className="text-xl font-semibold">{pct}%</div>
        <div className="h-2 bg-gray-200 rounded mt-1 overflow-hidden">
          <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  )
}

function createDefaultProfile(): BotProfile {
  return {
    bot_name: '자비스',
    greeting: '',
    persona_prompt: '',
    allowed_agents: ['concierge', 'operations'],
    guardrails: { max_discount_pct: 0, forbidden_phrases: [], require_hitl_for: ['refund', 'custom_discount'] },
    knowledge_scope: { include_shared: true, source_types: ['package', 'blog', 'attraction'] },
    monthly_token_quota: 5000000,
    rate_limit_per_min: 60,
    is_active: true,
  }
}
