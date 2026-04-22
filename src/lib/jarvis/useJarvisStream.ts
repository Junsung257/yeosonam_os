/**
 * 여소남 OS — Jarvis V2 Stream React Hook (Phase 6)
 *
 * 사용법:
 *   const { send, streaming, text, events, pendingAction, error } = useJarvisStream()
 *   await send("이번주 예약 알려줘")   // 토큰이 흘러들어오면서 text state 가 업데이트됨
 *
 * 동작:
 *   1) POST /api/jarvis/stream (SSE)
 *   2) 응답이 409 fallback:'v1' 이면 자동으로 /api/jarvis 로 폴백 (non-streaming)
 *   3) SSE 이벤트를 파싱해서 text / toolsUsed / agent / pendingAction 상태 업데이트
 *   4) 서버에서 'done' 이벤트를 받으면 streaming=false 로 전환
 */

'use client'

import { useCallback, useRef, useState } from 'react'

type EventType =
  | 'text_delta' | 'tool_use_start' | 'tool_result'
  | 'hitl_pending' | 'agent_picked' | 'cache_hit'
  | 'done' | 'error'

export interface JarvisStreamEvent {
  type: EventType
  data: any
}

export interface PendingActionView {
  id: string
  toolName: string
  description: string
  riskLevel: 'low' | 'medium' | 'high'
  args: Record<string, any>
}

export interface UseJarvisStreamOptions {
  sessionId?: string | null
  headers?: Record<string, string>
  onEvent?: (ev: JarvisStreamEvent) => void
  autoFallbackV1?: boolean // default true
}

export interface UseJarvisStreamResult {
  streaming: boolean
  text: string
  toolsUsed: string[]
  agent: string | null
  sessionId: string | null
  cacheHit: boolean | null
  pendingAction: PendingActionView | null
  error: string | null
  events: JarvisStreamEvent[]
  latencyMs: number | null
  engine: 'v2' | 'v1' | null
  send: (message: string) => Promise<void>
  reset: () => void
  abort: () => void
}

export function useJarvisStream(options: UseJarvisStreamOptions = {}): UseJarvisStreamResult {
  const autoFallback = options.autoFallbackV1 ?? true

  const [streaming, setStreaming] = useState(false)
  const [text, setText] = useState('')
  const [toolsUsed, setToolsUsed] = useState<string[]>([])
  const [agent, setAgent] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(options.sessionId ?? null)
  const [cacheHit, setCacheHit] = useState<boolean | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingActionView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<JarvisStreamEvent[]>([])
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [engine, setEngine] = useState<'v2' | 'v1' | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    setText('')
    setToolsUsed([])
    setAgent(null)
    setCacheHit(null)
    setPendingAction(null)
    setError(null)
    setEvents([])
    setLatencyMs(null)
    setEngine(null)
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
  }, [])

  const fallbackToV1 = useCallback(async (message: string, sid: string | null) => {
    setEngine('v1')
    const started = Date.now()
    const res = await fetch('/api/jarvis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      body: JSON.stringify({ message, sessionId: sid }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json?.error ?? `HTTP ${res.status}`)
      return
    }
    setAgent(json.agent ?? null)
    setText(json.response ?? '')
    setToolsUsed(json.toolsUsed ?? [])
    setSessionId(json.sessionId ?? sid)
    setPendingAction(json.pendingAction ?? null)
    setLatencyMs(Date.now() - started)
  }, [options.headers])

  const handleEvent = useCallback((ev: JarvisStreamEvent) => {
    options.onEvent?.(ev)
    setEvents(prev => [...prev, ev])
    switch (ev.type) {
      case 'agent_picked':
        setAgent(ev.data.agent)
        if (ev.data.sessionId) setSessionId(ev.data.sessionId)
        break
      case 'cache_hit':
        setCacheHit(!!ev.data.hit)
        break
      case 'text_delta':
        setText(prev => prev + (typeof ev.data === 'string' ? ev.data : ''))
        break
      case 'tool_use_start':
        setToolsUsed(prev => prev.includes(ev.data.name) ? prev : [...prev, ev.data.name])
        break
      case 'hitl_pending':
        setPendingAction(ev.data as PendingActionView)
        break
      case 'done':
        if (ev.data?.latencyMs) setLatencyMs(ev.data.latencyMs)
        break
      case 'error':
        setError(ev.data?.message ?? ev.data?.reason ?? 'stream error')
        break
    }
  }, [options])

  const send = useCallback(async (message: string) => {
    reset()
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/jarvis/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
        body: JSON.stringify({ message, sessionId }),
        signal: controller.signal,
      })

      // V2 미지원 agent → 409 + { fallback: 'v1' } → V1 으로 폴백
      if (res.status === 409 && autoFallback) {
        const hint = await res.json().catch(() => ({}))
        if (hint.sessionId) setSessionId(hint.sessionId)
        await fallbackToV1(message, hint.sessionId ?? sessionId)
        return
      }
      if (!res.ok || !res.body) {
        setError(`HTTP ${res.status}`)
        return
      }

      setEngine('v2')
      await parseSSE(res.body, handleEvent, controller.signal)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setError(err?.message ?? String(err))
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [sessionId, options.headers, autoFallback, handleEvent, fallbackToV1, reset])

  return {
    streaming, text, toolsUsed, agent, sessionId, cacheHit,
    pendingAction, error, events, latencyMs, engine,
    send, reset, abort,
  }
}

// ─── SSE 파서 (brower-side) ────────────────────────────────────────
async function parseSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (ev: JarvisStreamEvent) => void,
  signal: AbortSignal,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''

  while (!signal.aborted) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const raw of lines) {
      const line = raw.replace(/\r$/, '')
      if (line === '') {
        // 이벤트 경계 — 수집된 data 가 있으면 dispatch 는 아래 data 라인에서 이미 함
        currentEvent = ''
        continue
      }
      if (line.startsWith(':')) continue // comment (keepalive)
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        const payload = line.slice(5).trim()
        if (!payload) continue
        try {
          const parsed = JSON.parse(payload.replace(/\\n/g, '\n'))
          onEvent({ type: (currentEvent || 'text_delta') as EventType, data: parsed })
        } catch {
          // raw text
          onEvent({ type: (currentEvent || 'text_delta') as EventType, data: payload })
        }
      }
    }
  }
}
