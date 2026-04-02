'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { X, Send } from 'lucide-react'

const AGENT_LABELS: Record<string, string> = {
  operations: '운영',
  products: '상품',
  finance: '재무',
  marketing: '마케팅',
  sales: '영업',
  system: '시스템',
}

const QUICK_COMMANDS = [
  '미매칭 입금 보여줘',
  '이번달 매출 현황',
  '최근 예약 5개',
]

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agent?: string
  pendingAction?: any
}

interface PendingAction {
  id: string
  toolName: string
  description: string
  riskLevel: 'low' | 'medium' | 'high'
  args: Record<string, any>
}

const RISK_STYLES = {
  low:    { bg: 'bg-green-50', border: 'border-green-300', badge: 'bg-green-100 text-green-700', label: '낮음' },
  medium: { bg: 'bg-amber-50', border: 'border-amber-300', badge: 'bg-amber-100 text-amber-700', label: '보통' },
  high:   { bg: 'bg-red-50', border: 'border-red-300', badge: 'bg-red-100 text-red-700', label: '높음' },
}

export default function JarvisFloatingWidget() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'assistant', content: '안녕하세요! 자비스입니다. 무엇을 도와드릴까요?' }
  ])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // admin 페이지에서만 표시
  if (!pathname.startsWith('/admin')) return null
  // /admin/jarvis 페이지에서는 중복 방지 위해 숨김
  if (pathname.startsWith('/admin/jarvis')) return null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      })
      const data = await res.json()
      if (data.sessionId) setSessionId(data.sessionId)

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || data.error || '응답을 받지 못했습니다.',
        agent: data.agent,
        pendingAction: data.pendingAction,
      }])
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '오류가 발생했습니다. 다시 시도해주세요.',
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (actionId: string) => {
    const res = await fetch('/api/jarvis/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingActionId: actionId, approved: true }),
    })
    const data = await res.json()
    setMessages(prev => [...prev, {
      id: Date.now().toString(), role: 'assistant',
      content: data.message || '실행 완료',
    }])
  }

  const handleReject = async (actionId: string) => {
    await fetch('/api/jarvis/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingActionId: actionId, approved: false }),
    })
    setMessages(prev => [...prev, {
      id: Date.now().toString(), role: 'assistant', content: '취소되었습니다.',
    }])
  }

  return (
    <>
      {/* 플로팅 버튼 */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-purple-700 hover:bg-purple-800 text-white rounded-full shadow-lg flex items-center justify-center transition-all z-50 active:scale-95"
          aria-label="자비스 AI 열기"
        >
          <span className="text-lg font-bold">J</span>
        </button>
      )}

      {/* 채팅 팝업 */}
      {isOpen && (
        <div className="fixed bottom-0 right-0 md:bottom-6 md:right-6 w-full md:w-96 h-full md:h-[600px] md:max-h-[80vh] bg-white md:rounded-2xl shadow-2xl flex flex-col z-50 border border-gray-200">
          {/* 헤더 */}
          <div className="bg-purple-700 text-white px-4 py-3 md:rounded-t-2xl flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center font-bold text-sm">J</div>
              <div>
                <div className="font-bold text-sm">자비스 AI</div>
                <div className="text-[10px] text-white/80">여소남 OS 통합제어</div>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition">
              <X size={20} />
            </button>
          </div>

          {/* 메시지 영역 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {messages.map(msg => (
              <div key={msg.id}>
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%]`}>
                    {msg.agent && (
                      <div className="text-[10px] text-purple-600 mb-0.5 font-medium">
                        {AGENT_LABELS[msg.agent] || msg.agent}
                      </div>
                    )}
                    <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-purple-700 text-white rounded-br-sm'
                        : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                </div>
                {/* HITL 승인 카드 */}
                {msg.pendingAction && (
                  <ActionCardMini
                    action={msg.pendingAction}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                )}
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:0.1s]" />
                    <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 빠른 명령 */}
          <div className="px-3 py-1.5 flex gap-1.5 overflow-x-auto border-t border-gray-100">
            {QUICK_COMMANDS.map(cmd => (
              <button
                key={cmd}
                onClick={() => sendMessage(cmd)}
                className="whitespace-nowrap text-[11px] px-2.5 py-1 rounded-full border border-purple-200 text-purple-700 bg-white hover:bg-purple-50 transition"
              >
                {cmd}
              </button>
            ))}
          </div>

          {/* 입력 */}
          <div className="border-t border-gray-100 p-3 shrink-0">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage(input)
                  }
                }}
                placeholder="자비스에게 명령..."
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 resize-none text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 max-h-20"
                rows={1}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                className="w-10 h-10 bg-purple-700 hover:bg-purple-800 disabled:bg-gray-300 text-white rounded-xl flex items-center justify-center transition shrink-0"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// 미니 승인 카드 (팝업용)
function ActionCardMini({ action, onApprove, onReject }: {
  action: PendingAction
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
}) {
  const [loading, setLoading] = useState<string | null>(null)
  const style = RISK_STYLES[action.riskLevel]

  return (
    <div className={`rounded-lg border ${style.border} ${style.bg} p-3 my-2 ml-0 max-w-[85%]`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-gray-600">실행 요청</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${style.badge}`}>
          {style.label}
        </span>
      </div>
      <p className="text-xs font-medium text-gray-900 mb-1.5">{action.description}</p>
      <div className="bg-white/70 rounded p-1.5 mb-2 text-[10px] text-gray-500 font-mono">
        {Object.entries(action.args).slice(0, 3).map(([k, v]) => (
          <div key={k}><span className="text-purple-600">{k}</span>: {String(v)}</div>
        ))}
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={async () => { setLoading('a'); await onApprove(action.id); setLoading(null) }}
          disabled={loading !== null}
          className="flex-1 py-1.5 rounded-lg bg-purple-700 text-white text-xs font-semibold hover:bg-purple-800 disabled:opacity-50 transition"
        >
          {loading === 'a' ? '...' : '승인'}
        </button>
        <button
          onClick={async () => { setLoading('r'); await onReject(action.id); setLoading(null) }}
          disabled={loading !== null}
          className="flex-1 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-600 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 transition"
        >
          {loading === 'r' ? '...' : '취소'}
        </button>
      </div>
    </div>
  )
}
