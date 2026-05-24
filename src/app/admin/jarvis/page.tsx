'use client'
import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { ActionCard } from './components/ActionCard'
import AgentActionsPanel from './components/AgentActionsPanel'
import JarvisRagStatusCard from '@/components/admin/JarvisRagStatusCard'
import McpToolGuide from './components/McpToolGuide'

const AGENT_LABELS: Record<string, string> = {
  operations: '운영',
  products:   '상품',
  finance:    '재무',
  marketing:  '마케팅',
  sales:      '영업',
  system:     '시스템',
}

const QUICK_COMMANDS = [
  '오늘 미매칭 입금 보여줘',
  '이번달 매출 현황 알려줘',
  '키워드 성과 알려줘',
  '광고비 얼마 썼어?',
  '최적화 잘 되고 있어?',
  '콘텐츠 성과 종합',
]

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agent?: string
  pendingAction?: any
  timestamp: string
}

export default function JarvisPage() {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') === 'actions' ? 'actions' : 'chat'
  const [activeTab, setActiveTab] = useState<'chat' | 'actions'>(initialTab)
  const [pendingCount, setPendingCount] = useState(0)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: '안녕하세요 사장님! 여소남 OS 자비스입니다. 무엇을 도와드릴까요?',
      agent: undefined,
      timestamp: new Date().toISOString()
    }
  ])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [kakaoCount, setKakaoCount] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    fetch('/api/jarvis/kakao-inbox')
      .then(r => r.json())
      .then(d => setKakaoCount(d.count || 0))
      .catch(() => {})
    fetch('/api/agent-actions?status=pending&limit=1')
      .then(r => r.json())
      .then(d => setPendingCount(d.total || 0))
      .catch(() => {})
  }, [])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    }
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

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || data.error || '응답을 받지 못했습니다.',
        agent: data.agent,
        pendingAction: data.pendingAction,
        timestamp: new Date().toISOString()
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '오류가 발생했습니다. 다시 시도���주세요.',
        timestamp: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (pendingActionId: string) => {
    const res = await fetch('/api/jarvis/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingActionId, approved: true }),
    })
    const data = await res.json()
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'assistant',
      content: `${data.message || '실행 완료'}`,
      timestamp: new Date().toISOString()
    }])
  }

  const handleReject = async (pendingActionId: string) => {
    await fetch('/api/jarvis/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingActionId, approved: false }),
    })
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'assistant',
      content: '취소���었습니다.',
      timestamp: new Date().toISOString()
    }])
  }

  return (
    <div className="flex h-[calc(100vh-8rem)]">
      {/* 왼쪽: 채팅/결재함 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* RAG 색인 상태 */}
        <div className="mb-4">
          <JarvisRagStatusCard />
        </div>
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-white font-bold text-admin-base">J</div>
        <div>
          <h1 className="text-admin-h3 text-admin-text leading-tight">자비스 AI</h1>
          <p className="text-admin-xs text-admin-muted leading-tight">여소남 OS 전체 통합제어</p>
        </div>
        {/* 탭 */}
        <div className="ml-4 flex gap-1 bg-admin-surface-2 rounded-admin-sm p-1">
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-3 h-8 text-admin-sm font-medium rounded-admin-xs transition-colors ${
              activeTab === 'chat' ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'
            }`}
          >
            채팅
          </button>
          <button
            onClick={() => setActiveTab('actions')}
            className={`px-3 h-8 text-admin-sm font-medium rounded-admin-xs transition-colors inline-flex items-center gap-1 ${
              activeTab === 'actions' ? 'bg-admin-surface text-admin-text shadow-admin-xs' : 'text-admin-muted hover:text-admin-text-2'
            }`}
          >
            결재함
            {pendingCount > 0 && (
              <span className="bg-danger text-white text-admin-2xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center admin-num">
                {pendingCount}
              </span>
            )}
          </button>
        </div>
        {kakaoCount > 0 && (
          <button
            onClick={() => sendMessage(`미처리 카카오 메시지 ${kakaoCount}개 요약해줘`)}
            className="ml-auto flex items-center gap-1.5 bg-status-warningBg text-status-warningFg text-admin-xs font-semibold px-3 h-8 rounded-full hover:opacity-80 transition-opacity"
          >
            카카오 <span className="admin-num">{kakaoCount}</span>건
          </button>
        )}
        <button
          onClick={() => {
            setMessages([{
              id: '0', role: 'assistant',
              content: '대화를 초기화했습니다. 무엇을 도와드릴까요?',
              timestamp: new Date().toISOString()
            }])
            setSessionId(null)
          }}
          className="ml-auto text-admin-xs text-admin-muted hover:text-admin-text px-3 h-8 border border-admin-border-mid rounded-admin-sm hover:bg-admin-surface-2 hover:border-admin-border-strong transition-colors bg-admin-surface font-medium"
        >
          초기화
        </button>
      </div>

      {/* 결재함 탭 */}
      {activeTab === 'actions' && (
        <div className="flex-1 overflow-y-auto">
          <AgentActionsPanel />
        </div>
      )}

      {/* 채팅 탭 */}
      {activeTab === 'chat' && (
        <>
          {/* 메시지 영역 */}
          <div className="flex-1 overflow-y-auto admin-card p-4 space-y-3">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] ${msg.role === 'user' ? 'order-2' : ''}`}>
                  {/* Agent 뱃지 */}
                  {msg.agent && (
                    <div className="text-admin-xs text-brand mb-1 font-semibold uppercase tracking-wider">
                      {AGENT_LABELS[msg.agent] || msg.agent}
                    </div>
                  )}
                  {/* 말풍선 */}
                  <div className={`rounded-admin-lg px-4 py-2.5 text-admin-sm whitespace-pre-wrap leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-brand text-white rounded-tr-sm'
                      : 'bg-admin-surface border border-admin-border-mid text-admin-text rounded-tl-sm shadow-admin-xs'
                  }`}>
                    {msg.content}
                  </div>
                  {/* HITL 승인 카드 */}
                  {msg.pendingAction && (
                    <ActionCard
                      action={msg.pendingAction}
                      onApprove={handleApprove}
                      onReject={handleReject}
                    />
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="admin-card px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-brand rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-brand rounded-full animate-bounce [animation-delay:0.1s]" />
                    <div className="w-2 h-2 bg-brand rounded-full animate-bounce [animation-delay:0.2s]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* 빠른 명령 */}
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
            {QUICK_COMMANDS.map(cmd => (
              <button
                key={cmd}
                onClick={() => sendMessage(cmd)}
                className="whitespace-nowrap text-admin-xs px-3 py-1.5 rounded-full border border-brand/20 text-brand bg-brand-light hover:bg-brand-light/70 transition-colors font-medium"
              >
                {cmd}
              </button>
            ))}
          </div>

          {/* 입력창 */}
          <div className="flex gap-2 mt-2 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage(input)
                }
              }}
              placeholder="자비스에게 명령하세요… (카카오 채팅 내역 붙여넣기 가능)"
              className="flex-1 resize-none border border-admin-border-mid rounded-admin-md px-3 py-2 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors min-h-[42px] max-h-[120px]"
              rows={1}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              className="w-10 h-10 bg-brand text-white rounded-admin-md flex items-center justify-center hover:bg-brand-dark disabled:opacity-40 disabled:bg-admin-border-mid transition-colors"
            >
              &uarr;
            </button>
          </div>
          <p className="text-admin-xs text-admin-muted-2 mt-1.5">Enter 전송 / Shift+Enter 줄바꿈</p>
        </>
      )}
      </div> {/* /채팅/결재함 영역 */}

      {/* 오른쪽: MCP 도구 가이드 */}
      <McpToolGuide />
    </div>
  )
}
