'use client'
import { useState, useRef } from 'react'
import { Sparkle, Loader2, SendHorizonal, X } from 'lucide-react'

interface JarvisQuickAskProps {
  /** AI 네이티브 프롬프트 */
  prompt?: string
  /** 사전 정의된 명령어 목록 */
  suggestions?: string[]
  /** 콤팩트 모드 (아이콘만 표시) */
  compact?: boolean
  /** 콘텐츠 타입 힌트 */
  contentType?: 'marketing' | 'operations' | 'products' | 'finance'
  /** 명령어를 받아서 자비스 페이지로 이동 */
  onNavigateToJarvis?: (message: string) => void
}

const AGENT_CHANNEL: Record<string, string> = {
  marketing: '마케팅',
  operations: '운영',
  products: '상품',
  finance: '재무',
}

export default function JarvisQuickAsk({
  prompt,
  suggestions,
  compact,
  contentType,
  onNavigateToJarvis,
}: JarvisQuickAskProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleAsk = async () => {
    const text = input.trim()
    if (!text) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          agentType: contentType,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setResult(data.response || '처리 완료')
      }
    } catch {
      setError('통신 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const quickSuggestions = suggestions ?? (
    contentType === 'marketing'
      ? ['키워드 성과 알려줘', '광고비 얼마 썼어?', '최적화 잘 되고 있어?', '콘텐츠 성과 종합']
      : contentType === 'operations'
      ? ['오늘 예약 현황 알려줘', '미매칭 입금 있어?']
      : contentType === 'products'
      ? ['인기 상품 TOP5 알려줘', '다낭 5월 상품 찾아줘']
      : contentType === 'finance'
      ? ['이번달 매출 현황', '정산 내역 좀 봐줘']
      : ['자비스 도움말', '키워드 성과 알려줘']
  )

  if (compact) {
    return (
      <div className="relative">
        <button
          onClick={() => { setOpen(!open); setResult(null); setError(null) }}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-admin-surface-hover transition-colors text-admin-muted hover:text-brand"
          title="자비스에게 물어보기"
        >
          <Sparkle className="w-4 h-4" />
        </button>
        {open && (
          <div className="absolute right-0 top-10 w-80 bg-admin-surface border border-admin-border rounded-lg shadow-xl z-50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-admin-text">
                {contentType ? `${AGENT_CHANNEL[contentType] ?? ''} 자비스` : '자비스'}
              </span>
              <button onClick={() => setOpen(false)} className="text-admin-muted hover:text-admin-text">
                <X className="w-4 h-4" />
              </button>
            </div>
            <QuickAskBody
              input={input} setInput={setInput}
              loading={loading} result={result} error={error}
              suggestions={quickSuggestions}
              onAsk={handleAsk} inputRef={inputRef}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="admin-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkle className="w-4 h-4 text-brand" />
        <span className="text-[13px] font-semibold text-admin-text">
          {contentType ? `${AGENT_CHANNEL[contentType] ?? ''} 자비스` : '자비스 AI'}
        </span>
        {prompt && (
          <span className="text-[11px] text-admin-muted-2">· {prompt}</span>
        )}
      </div>
      <QuickAskBody
        input={input} setInput={setInput}
        loading={loading} result={result} error={error}
        suggestions={quickSuggestions}
        onAsk={handleAsk} inputRef={inputRef}
        showSuggestions={true}
      />
    </div>
  )
}

function QuickAskBody({
  input, setInput, loading, result, error, suggestions, onAsk, inputRef, showSuggestions
}: {
  input: string; setInput: (v: string) => void
  loading: boolean; result: string | null; error: string | null
  suggestions: string[]; onAsk: () => void; inputRef: React.RefObject<HTMLTextAreaElement | null>
  showSuggestions?: boolean
}) {
  return (
    <>
      {/* 결과 */}
      {result && (
        <div className="bg-brand-light/30 border border-brand/10 rounded-md px-3 py-2 text-[12px] text-admin-text-2 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
          {result}
        </div>
      )}
      {error && (
        <div className="bg-danger/10 border border-danger/20 rounded-md px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      )}

      {/* 추천 명령 */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => { setInput(s); onAsk() }}
              className="text-[11px] px-2 py-1 rounded-full border border-border text-admin-muted hover:text-brand hover:border-brand/30 transition-colors bg-admin-surface"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* 입력 */}
      <div className="flex gap-1.5 items-end">
        <textarea
          ref={inputRef as React.Ref<HTMLTextAreaElement>}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onAsk()
            }
          }}
          placeholder="자비스에게 물어보세요…"
          className="flex-1 resize-none border border-border rounded-md px-2.5 py-1.5 text-[12px] bg-admin-surface text-admin-text focus:outline-none focus:border-brand transition-colors min-h-[32px] max-h-[80px]"
          rows={1}
        />
        <button
          onClick={onAsk}
          disabled={loading || !input.trim()}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-brand text-white hover:bg-brand-dark disabled:opacity-40 transition-colors shrink-0"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SendHorizonal className="w-3.5 h-3.5" />}
        </button>
      </div>
    </>
  )
}
