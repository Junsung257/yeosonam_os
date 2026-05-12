'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

export type GuestBookingSnapshot = {
  booking_no?: string | null;
  package_title?: string | null;
  status: string;
  status_label: string;
  departure_date?: string | null;
  total_price: number;
  paid_amount: number;
  deposit_amount: number;
  adult_count: number;
  child_count: number;
};

type ChatRow = { id: string; role: string; content: string; created_at: string };

const QUICK_CHIPS = ['준비물이 궁금해요', '일정표는 어디서 보나요?', '현지에서 연락이 필요해요'];

export default function GuestTripPortalClient(props: {
  snapshot: GuestBookingSnapshot;
  portalToken: string;
}) {
  const { snapshot: b, portalToken } = props;
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [aiPaused, setAiPaused] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadMessagesError, setLoadMessagesError] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const scrollToBottom = useCallback(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const fetchMessages = useCallback(async () => {
    const res = await fetch('/api/booking-concierge/messages', { credentials: 'include' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error((j as { error?: string }).error || '메시지를 불러오지 못했습니다.');
    }
    const j = (await res.json()) as { messages: ChatRow[]; aiPaused?: boolean };
    setMessages(j.messages ?? []);
    if (typeof j.aiPaused === 'boolean') setAiPaused(j.aiPaused);
    setLoadMessagesError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/booking-portal/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token: portalToken }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error((j as { error?: string }).error || '세션을 만들지 못했습니다.');
        }
        if (cancelled) return;
        setSessionReady(true);
        await fetchMessages();
      } catch (e) {
        if (!cancelled) {
          setSessionError(e instanceof Error ? e.message : '오류가 발생했습니다.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portalToken, fetchMessages]);

  useEffect(() => {
    if (!sessionReady) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetchMessages().catch(() => {});
    }, 6000);
    return () => window.clearInterval(t);
  }, [sessionReady, fetchMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || sending || !sessionReady) return;
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/booking-concierge/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: msg }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((j as { error?: string }).error || '전송에 실패했습니다.');
      }
      if (typeof (j as { aiPaused?: boolean }).aiPaused === 'boolean') {
        setAiPaused(Boolean((j as { aiPaused?: boolean }).aiPaused));
      }
      await fetchMessages();
    } catch (e) {
      setLoadMessagesError(e instanceof Error ? e.message : '전송 오류');
    } finally {
      setSending(false);
    }
  }

  if (sessionError) {
    return (
      <main className="min-h-[100dvh] flex flex-col items-center justify-center px-4 bg-slate-100 text-slate-800">
        <p className="text-center text-sm text-red-700 max-w-sm">{sessionError}</p>
        <Link href="/" className="mt-6 text-sm text-blue-600 underline underline-offset-2">
          홈으로
        </Link>
      </main>
    );
  }

  return (
    <main
      ref={mainRef}
      className="min-h-[100dvh] flex flex-col bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800 overscroll-y-none"
      style={{ overscrollBehaviorY: 'none' }}
    >
      <div className="flex-1 flex flex-col max-w-lg w-full mx-auto px-3 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <div className="rounded-2xl bg-white shadow-lg ring-1 ring-slate-200/80 overflow-hidden shrink-0">
          <div className="bg-slate-800 px-4 py-3">
            <p className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase">예약 요약</p>
            <h1 className="text-base font-bold text-white mt-0.5">여소남 여행 예약</h1>
          </div>
          <div className="p-4 space-y-3 text-[13px]">
            <div className="flex justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-slate-500">예약번호</span>
              <span className="font-mono font-semibold text-slate-900">{b.booking_no ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-slate-500">상품</span>
              <span className="font-medium text-right text-slate-900 line-clamp-2">{b.package_title ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-slate-500">진행</span>
              <span className="font-semibold text-emerald-700">{b.status_label}</span>
            </div>
            {b.departure_date && (
              <div className="flex justify-between gap-2 border-b border-slate-100 pb-2">
                <span className="text-slate-500">출발일</span>
                <span className="font-medium">{b.departure_date}</span>
              </div>
            )}
            <div className="flex justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-slate-500">인원</span>
              <span className="font-medium">
                성인 {b.adult_count ?? 0}
                {(b.child_count ?? 0) > 0 ? ` · 아동 ${b.child_count}` : ''}
              </span>
            </div>
            <div className="flex justify-between gap-2 border-b border-slate-100 pb-2">
              <span className="text-slate-500">총 금액</span>
              <span className="font-bold tabular-nums">{(b.total_price ?? 0).toLocaleString()}원</span>
            </div>
            {(b.deposit_amount ?? 0) > 0 && (
              <div className="flex justify-between gap-2 border-b border-slate-100 pb-2">
                <span className="text-slate-500">계약금 기준</span>
                <span className="font-medium tabular-nums">{(b.deposit_amount ?? 0).toLocaleString()}원</span>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">납부 합계</span>
              <span className="font-semibold tabular-nums text-blue-700">
                {(b.paid_amount ?? 0).toLocaleString()}원
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex-1 flex flex-col min-h-[14rem] rounded-2xl bg-white shadow-md ring-1 ring-slate-200/70 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/90">
            <p className="text-[12px] font-semibold text-slate-700">AI 컨시어지 (베타)</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              환불·취소·금액 확정은 챗봇 확답 없이 상담을 통해 진행됩니다.
            </p>
            {aiPaused && (
              <p className="mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200/80 rounded-lg px-2 py-1.5 leading-snug">
                상담 직원이 연결되었습니다. AI 자동 답변은 잠시 멈춰 있으며, 담당자가 순서대로 답변드립니다.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2" style={{ overscrollBehavior: 'contain' }}>
            {!sessionReady && (
              <div className="animate-pulse space-y-2 px-1">
                <div className="h-9 bg-slate-100 rounded-xl w-4/5" />
                <div className="h-9 bg-slate-100 rounded-xl w-3/5 ml-auto" />
                <div className="h-9 bg-slate-100 rounded-xl w-2/3" />
              </div>
            )}
            {sessionReady && messages.length === 0 && !loadMessagesError && (
              <p className="text-[12px] text-slate-500 text-center py-6 px-2">
                궁금한 점을 입력하거나 아래 버튼을 눌러 보세요.
              </p>
            )}
            {loadMessagesError && (
              <p className="text-[11px] text-red-600 text-center py-1">{loadMessagesError}</p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : m.role === 'staff'
                        ? 'bg-amber-50 text-amber-950 ring-1 ring-amber-200/80 rounded-bl-md'
                        : 'bg-slate-100 text-slate-800 rounded-bl-md'
                  }`}
                >
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                </div>
              </div>
            ))}
            {sending && !aiPaused && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-2xl rounded-bl-md px-3 py-2 text-[12px] text-slate-500 italic">
                  답변을 준비하고 있습니다…
                </div>
              </div>
            )}
            <div ref={listEndRef} />
          </div>

          <div className="border-t border-slate-100 bg-white px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {QUICK_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={!sessionReady || sending}
                  onClick={() => {
                    setInput(c);
                    void send(c);
                  }}
                  className="shrink-0 text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200/80 disabled:opacity-40"
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                disabled={!sessionReady || sending}
                placeholder={sessionReady ? '메시지 입력…' : '연결 중…'}
                rows={1}
                className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-slate-50 max-h-28"
              />
              <button
                type="button"
                disabled={!sessionReady || sending || !input.trim()}
                onClick={() => void send()}
                className="shrink-0 rounded-xl bg-slate-800 text-white text-[13px] font-medium px-4 py-2 disabled:opacity-40"
              >
                보내기
              </button>
            </div>
          </div>
        </div>

        <p className="mt-2 text-center text-[10px] text-slate-500 leading-relaxed px-1">
          링크는 본인만 사용해 주세요. 세부 변경은 카카오톡 채널로도 문의하실 수 있습니다.
        </p>
        <div className="text-center pb-1">
          <Link
            href="/"
            className="text-[12px] text-blue-600 hover:text-blue-800 font-medium underline underline-offset-2"
          >
            홈으로
          </Link>
        </div>
      </div>
    </main>
  );
}
