'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  getStatusLabel, getStatusBadgeClass,
  getAgentTypeLabel, getAgentTypeBadgeClass,
  getPriorityLabel, getPriorityBadgeClass,
} from '@/lib/agent-action-machine'

interface AgentAction {
  id: string
  agent_type: string
  action_type: string
  summary: string
  payload: Record<string, any>
  status: string
  result_log: string | null
  requested_by: string
  reviewed_by: string | null
  priority: string
  reject_reason: string | null
  expires_at: string | null
  created_at: string
  resolved_at: string | null
}

const STATUS_TABS = [
  { key: 'pending', label: '대기' },
  { key: 'approved', label: '승인' },
  { key: 'executed', label: '완료' },
  { key: 'rejected', label: '반려' },
  { key: 'failed', label: '실패' },
  { key: 'all', label: '전체' },
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '방금'
  if (mins < 60) return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}시간 전`
  const days = Math.floor(hrs / 24)
  return `${days}일 전`
}

export default function AgentActionsPanel() {
  const [actions, setActions] = useState<AgentAction[]>([])
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const limit = 20

  const fetchActions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/agent-actions?status=${statusFilter}&page=${page}&limit=${limit}`,
      )
      const data = await res.json()
      setActions(data.actions ?? [])
      setTotal(data.total ?? 0)
    } catch {
      setActions([])
    } finally {
      setLoading(false)
    }
  }, [statusFilter, page])

  useEffect(() => {
    fetchActions()
    const interval = setInterval(fetchActions, 30000)
    return () => clearInterval(interval)
  }, [fetchActions])

  useEffect(() => { setPage(1) }, [statusFilter])

  const showToast = (msg: string, type: 'ok' | 'err') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  const handleAction = async (actionId: string, action: 'approve' | 'reject') => {
    setProcessingId(actionId)
    try {
      const body: any = { action_id: actionId, action }
      if (action === 'reject' && rejectReason.trim()) {
        body.reject_reason = rejectReason.trim()
      }
      const res = await fetch('/api/agent-actions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      showToast(action === 'approve' ? '승인 완료' : '반려 완료', 'ok')
      setRejectId(null)
      setRejectReason('')
      fetchActions()
    } catch (err: any) {
      showToast(err.message || '처리 실패', 'err')
    } finally {
      setProcessingId(null)
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-3">
      {/* 상태 필터 탭 */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition ${
              statusFilter === tab.key
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 카운트 */}
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-slate-500">
          총 {total}건 {loading && '(로딩 중...)'}
        </p>
        <button
          onClick={fetchActions}
          className="text-[11px] text-blue-600 hover:underline"
        >
          새로고침
        </button>
      </div>

      {/* 액션 리스트 */}
      {actions.length === 0 && !loading ? (
        <div className="text-center py-12 text-slate-400 text-[13px]">
          {statusFilter === 'pending' ? '대기 중인 결재 건이 없습니다.' : '해당 상태의 건이 없습니다.'}
        </div>
      ) : (
        <div className="space-y-2">
          {actions.map(action => (
            <div
              key={action.id}
              className="border border-slate-200 rounded-lg bg-white hover:border-slate-300 transition"
            >
              {/* 카드 헤더 */}
              <div
                className="p-3 cursor-pointer"
                onClick={() => setExpandedId(expandedId === action.id ? null : action.id)}
              >
                {/* 배지 줄 */}
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${getAgentTypeBadgeClass(action.agent_type)}`}>
                    {getAgentTypeLabel(action.agent_type)}
                  </span>
                  {action.priority !== 'normal' && (
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${getPriorityBadgeClass(action.priority)}`}>
                      {getPriorityLabel(action.priority)}
                    </span>
                  )}
                  <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${getStatusBadgeClass(action.status)}`}>
                    {getStatusLabel(action.status)}
                  </span>
                  <span className="ml-auto text-[10px] text-slate-400">
                    {timeAgo(action.created_at)}
                  </span>
                </div>
                {/* 요약 */}
                <p className="text-[13px] font-medium text-slate-800">{action.summary}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {action.action_type} · {action.requested_by}
                  {action.reviewed_by && ` · 처리: ${action.reviewed_by}`}
                </p>
              </div>

              {/* 확장 영역: payload */}
              {expandedId === action.id && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="bg-slate-50 rounded-lg p-2.5 text-xs text-slate-600 font-mono max-h-60 overflow-y-auto">
                    {Object.entries(action.payload).map(([k, v]) => (
                      <div key={k} className="break-all">
                        <span className="text-purple-700">{k}</span>:{' '}
                        {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                      </div>
                    ))}
                    {Object.keys(action.payload).length === 0 && (
                      <span className="text-slate-400">페이로드 없음</span>
                    )}
                  </div>

                  {/* 결과 로그 (실행완료/실패 시) */}
                  {action.result_log && (
                    <div className={`rounded-lg p-2.5 text-xs font-mono max-h-40 overflow-y-auto ${
                      action.status === 'executed'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-700'
                    }`}>
                      {action.result_log}
                    </div>
                  )}

                  {/* 반려 사유 */}
                  {action.reject_reason && (
                    <div className="bg-red-50 rounded-lg p-2.5 text-xs text-red-700">
                      반려 사유: {action.reject_reason}
                    </div>
                  )}

                  {/* 승인/반려 버튼 (pending만) */}
                  {action.status === 'pending' && (
                    <div className="space-y-2">
                      {rejectId === action.id && (
                        <textarea
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          placeholder="반려 사유 (선택)"
                          className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] focus:ring-1 focus:ring-[#005d90] focus:outline-none resize-none"
                          rows={2}
                        />
                      )}
                      <div className="flex gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAction(action.id, 'approve') }}
                          disabled={processingId === action.id}
                          className="flex-1 bg-[#001f3f] text-white py-1.5 rounded text-[11px] font-medium hover:bg-blue-900 disabled:bg-slate-300 transition"
                        >
                          {processingId === action.id ? '처리 중...' : '승인'}
                        </button>
                        {rejectId === action.id ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAction(action.id, 'reject') }}
                            disabled={processingId === action.id}
                            className="flex-1 bg-red-600 text-white py-1.5 rounded text-[11px] font-medium hover:bg-red-700 disabled:bg-slate-300 transition"
                          >
                            {processingId === action.id ? '처리 중...' : '반려 확정'}
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setRejectId(action.id); setRejectReason('') }}
                            className="flex-1 bg-white border border-slate-300 text-slate-600 py-1.5 rounded text-[11px] font-medium hover:bg-slate-50 transition"
                          >
                            반려
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-2 py-1 text-[11px] border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-[11px] text-slate-500">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-2 py-1 text-[11px] border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg text-white text-[13px] shadow-lg ${
          toast.type === 'err' ? 'bg-red-600' : 'bg-slate-800'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
