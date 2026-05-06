'use client'
import { useState } from 'react'

interface PendingAction {
  id: string
  toolName: string
  description: string
  riskLevel: 'low' | 'medium' | 'high'
  args: Record<string, any>
}

interface ActionCardProps {
  action: PendingAction
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
}

const RISK_STYLES = {
  low:    { bg: 'bg-green-50',  border: 'border-green-300',  badge: 'bg-green-100 text-green-700',  label: '낮음' },
  medium: { bg: 'bg-amber-50',  border: 'border-amber-300',  badge: 'bg-amber-100 text-amber-700',  label: '보���' },
  high:   { bg: 'bg-red-50',    border: 'border-red-300',    badge: 'bg-red-100 text-red-700',      label: '높음' },
}

export function ActionCard({ action, onApprove, onReject }: ActionCardProps) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const style = RISK_STYLES[action.riskLevel]

  const handleApprove = async () => {
    setLoading('approve')
    await onApprove(action.id)
    setLoading(null)
  }
  const handleReject = async () => {
    setLoading('reject')
    await onReject(action.id)
    setLoading(null)
  }

  return (
    <div className={`rounded-xl border-2 ${style.border} ${style.bg} p-4 my-3 max-w-md`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-700">자비스 실행 요청</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.badge}`}>
          위험도 {style.label}
        </span>
      </div>

      <p className="text-sm font-medium text-slate-900 mb-2">{action.description}</p>

      {/* 실행 파라미터 요약 */}
      <div className="bg-white/70 rounded-lg p-2.5 mb-3 text-xs text-slate-600 font-mono">
        {Object.entries(action.args).map(([k, v]) => (
          <div key={k}><span className="text-purple-700">{k}</span>: {String(v)}</div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={loading !== null}
          className="flex-1 py-2 rounded-lg bg-purple-700 text-white text-sm font-semibold hover:bg-purple-800 disabled:opacity-50 transition"
        >
          {loading === 'approve' ? '처리 중...' : '승인'}
        </button>
        <button
          onClick={handleReject}
          disabled={loading !== null}
          className="flex-1 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 transition"
        >
          {loading === 'reject' ? '처리 중...' : '취소'}
        </button>
      </div>
    </div>
  )
}
