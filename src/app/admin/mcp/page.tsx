'use client'

/**
 * 여소남 OS — MCP 설정 페이지
 *
 * MCP API 키 조회/발급/관리
 * 외부 AI 연결을 위한 엔드포인트 정보 제공
 */

import { useState, useEffect, useCallback, useRef } from 'react'

interface McpToken {
  id: string
  label: string
  token_prefix: string
  role: string
  is_active: boolean
  last_used_at: string | null
  created_at: string
}

export default function McpSettingsPage() {
  const [tokens, setTokens] = useState<McpToken[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [newRole, setNewRole] = useState<'tenant_staff' | 'tenant_admin' | 'platform_admin'>('tenant_staff')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copySuccess, setCopySuccess] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<McpToken | null>(null)
  const [revoking, setRevoking] = useState(false)
  const revokeCancelRef = useRef<HTMLButtonElement | null>(null)

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/mcp/tokens')
      if (!res.ok) throw new Error('조회 실패')
      const data = await res.json()
      setTokens(data.tokens ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTokens() }, [fetchTokens])

  useEffect(() => {
    if (!revokeTarget) return
    requestAnimationFrame(() => revokeCancelRef.current?.focus())
  }, [revokeTarget])

  const handleCreate = async () => {
    if (!newLabel.trim()) return
    setError('')
    setNewToken(null)
    try {
      const res = await fetch('/api/admin/mcp/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim(), role: newRole }),
      })
      if (!res.ok) throw new Error('생성 실패')
      const data = await res.json()
      setNewToken(data.token) // 최초 1회만 표시
      setNewLabel('')
      await fetchTokens()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleRevoke = (token: McpToken) => {
    setError('')
    setRevokeTarget(token)
  }

  const submitRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      const res = await fetch(`/api/admin/mcp/tokens?id=${revokeTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('비활성화 실패')
      setRevokeTarget(null)
      await fetchTokens()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRevoking(false)
    }
  }

  const handleCopy = async () => {
    if (newToken) {
      await navigator.clipboard.writeText(newToken)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 3000)
    }
  }

  const mcpEndpoint = typeof window !== 'undefined'
    ? `${window.location.origin}/api/mcp`
    : 'https://yeosonam.com/api/mcp'

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">MCP 게이트웨이 설정</h1>
      <p className="text-sm text-gray-500 mb-6">
        외부 AI (Claude Desktop, Cursor IDE, ChatGPT 등)가 여소남OS 데이터에 접근할 수 있게 해주는 MCP 표준 인터페이스입니다.
      </p>

      {/* 엔드포인트 정보 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h2 className="font-semibold text-blue-800 mb-2">MCP 엔드포인트</h2>
        <p className="text-sm text-blue-700 mb-1">
          Claude Desktop/Cursor에서 아래 URL을 MCP 서버로 등록하세요:
        </p>
        <code className="block bg-blue-100 px-3 py-2 rounded text-sm font-mono">
          {mcpEndpoint}
        </code>
        <div className="mt-3 text-sm text-blue-700">
          <p className="font-medium mb-1">Claude Desktop 설정 예시 (claude_desktop_config.json):</p>
          <pre className="bg-blue-100 px-3 py-2 rounded text-xs font-mono whitespace-pre-wrap">{`{
  "mcpServers": {
    "yeosonam": {
      "url": "${mcpEndpoint}",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}`}</pre>
        </div>
      </div>

      {/* 새 키 발급 */}
      <div className="bg-white border rounded-lg p-4 mb-6">
        <h2 className="font-semibold mb-3">새 MCP 키 발급</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="mcp-key-label" className="block text-xs text-gray-500 mb-1">키 설명</label>
            <input
              id="mcp-key-label"
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              placeholder="예: Claude Desktop, Cursor IDE"
              className="w-full px-3 py-2 border rounded text-sm"
            />
          </div>
          <div>
            <label htmlFor="mcp-key-role" className="block text-xs text-gray-500 mb-1">권한</label>
            <select
              id="mcp-key-role"
              value={newRole}
              onChange={e => setNewRole(e.target.value as 'tenant_staff' | 'tenant_admin' | 'platform_admin')}
              className="px-3 py-2 border rounded text-sm"
            >
              <option value="tenant_staff">읽기 전용 (Read)</option>
              <option value="tenant_admin">읽기+쓰기 (Read+Write)</option>
              <option value="platform_admin">전체 (Admin)</option>
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={!newLabel.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50"
          >
            발급
          </button>
        </div>

        {newToken && (
          <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded p-3">
            <p className="text-sm font-semibold text-yellow-800 mb-1">
              ⚠️ 키는 지금만 확인 가능합니다. 안전한 곳에 저장하세요.
            </p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 bg-yellow-100 px-2 py-1 rounded text-xs font-mono break-all">
                {newToken}
              </code>
              <button
                onClick={handleCopy}
                className="px-3 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700 shrink-0"
              >
                {copySuccess ? '✅ 복사됨' : '복사'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 키 목록 */}
      <div className="bg-white border rounded-lg p-4">
        <h2 className="font-semibold mb-3">발급된 MCP 키</h2>
        {loading ? (
          <p className="text-sm text-gray-400">로딩 중...</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-gray-400">아직 발급된 키가 없습니다.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 pr-4">설명</th>
                <th className="pb-2 pr-4">키 (앞자리)</th>
                <th className="pb-2 pr-4">권한</th>
                <th className="pb-2 pr-4">상태</th>
                <th className="pb-2 pr-4">마지막 사용</th>
                <th className="pb-2"><span className="sr-only">작업</span></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id} className="border-b border-gray-100">
                  <td className="py-2 pr-4">{t.label}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{t.token_prefix}...</td>
                  <td className="py-2 pr-4">{t.role}</td>
                  <td className="py-2 pr-4">
                    <span className={t.is_active ? 'text-green-600' : 'text-red-400'}>
                      {t.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">
                    {t.last_used_at ?? '사용 안 함'}
                  </td>
                  <td className="py-2">
                    {t.is_active && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(t)}
                        aria-haspopup="dialog"
                        aria-expanded={revokeTarget?.id === t.id}
                        aria-controls="mcp-token-revoke-confirm-dialog"
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        비활성화
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {error && (
          <p className="mt-3 text-sm text-red-500">{error}</p>
        )}
      </div>

      {revokeTarget && (
        <div className="fixed inset-0 z-[60] flex h-dvh items-center justify-center overflow-y-auto px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            aria-label="MCP 키 비활성화 확인 닫기"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setRevokeTarget(null)}
          />
          <div
            id="mcp-token-revoke-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-token-revoke-confirm-title"
            aria-describedby="mcp-token-revoke-confirm-description mcp-token-revoke-confirm-summary"
            className="relative w-full max-w-md rounded-admin-md border border-red-100 bg-white p-5 shadow-admin-lg"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">MCP access</p>
              <h2 id="mcp-token-revoke-confirm-title" className="text-lg font-bold text-admin-text">
                MCP 키를 비활성화할까요?
              </h2>
              <p id="mcp-token-revoke-confirm-description" className="text-sm leading-6 text-admin-muted">
                이 키를 사용하는 Claude Desktop, Cursor, 외부 AI 연결이 즉시 실패할 수 있습니다.
              </p>
            </div>

            <dl
              id="mcp-token-revoke-confirm-summary"
              className="mt-4 grid grid-cols-1 gap-2 rounded-admin-sm bg-red-50 p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">설명</dt>
                <dd className="font-semibold text-admin-text">{revokeTarget.label}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">키 prefix</dt>
                <dd className="font-mono text-xs font-semibold text-admin-text">{revokeTarget.token_prefix}...</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">권한</dt>
                <dd className="font-semibold text-admin-text">{revokeTarget.role}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-admin-muted">마지막 사용</dt>
                <dd className="font-semibold text-admin-text">{revokeTarget.last_used_at ?? '-'}</dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={revokeCancelRef}
                type="button"
                onClick={() => setRevokeTarget(null)}
                className="rounded-admin-sm border border-admin-border bg-white px-4 py-2 text-sm font-medium text-admin-text hover:bg-admin-surface-2"
              >
                다시 확인
              </button>
              <button
                type="button"
                onClick={submitRevoke}
                disabled={revoking}
                className="rounded-admin-sm bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {revoking ? '처리 중...' : '비활성화'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
