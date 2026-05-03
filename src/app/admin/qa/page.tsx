'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { ChatMessage } from '@/lib/chat-store';
import { buildQaChatHistory } from '@/lib/qa-chat-history';

const ADMIN_QA_SESSION_KEY = 'ys_admin_qa_session';

interface RecommendedPackage {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  sellingPrice?: number;
  commissionRate?: number;
}

interface JourneyPanel {
  stage: string;
  updated_at: string;
  checklist_preview: string[];
  automation_hints: string[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  packages?: RecommendedPackage[];
  escalated?: boolean;
  freeTravelHref?: string;
}

type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'text_final'; content: string }
  | {
      type: 'meta';
      packages: RecommendedPackage[];
      escalate: boolean;
      critiqueSeverity: string;
      journey?: JourneyPanel;
      freeTravelHref?: string | null;
    }
  | { type: 'error'; message: string }
  | { type: 'done' };

export default function QAPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        '안녕하세요! 여소남 여행사 AI 상담원입니다. 여행 목적지, 예산, 인원, 기간을 알려주시면 최적의 상품을 추천해드립니다.\n\n(이 페이지는 실제 `/api/qa/chat` NDJSON 스트림과 동일하게 동작하며, 오른쪽에서 **고객 여정 단계**를 확인할 수 있습니다.)',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [journey, setJourney] = useState<JourneyPanel | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let sid = sessionStorage.getItem(ADMIN_QA_SESSION_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      sessionStorage.setItem(ADMIN_QA_SESSION_KEY, sid);
    }
    setSessionId(sid);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const resetSession = useCallback(() => {
    const sid = crypto.randomUUID();
    sessionStorage.setItem(ADMIN_QA_SESSION_KEY, sid);
    setSessionId(sid);
    setJourney(null);
    setMessages([
      {
        role: 'assistant',
        content: '새 세션이 시작되었습니다. 무엇을 도와드릴까요?',
      },
    ]);
  }, []);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || isLoading || !sessionId) return;

    const userMessage: Message = { role: 'user', content: msg };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const history = buildQaChatHistory(
      [...messages, userMessage].slice(1).map(
        (m, idx) =>
          ({
            id: `adm-${idx}`,
            role: m.role,
            content: m.content,
            timestamp: new Date(),
          }) as ChatMessage,
      ),
      10,
    );

    let assistantContent = '';
    let metaPackages: RecommendedPackage[] = [];
    let metaEscalate = false;
    let metaFreeTravelHref: string | null = null;

    try {
      const res = await fetch('/api/qa/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          sessionId,
          history,
          referrer: 'admin_qa',
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          let ev: StreamEvent;
          try {
            ev = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }

          if (ev.type === 'text') {
            assistantContent += ev.content;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && prev.length > 0) {
                const head = prev.slice(0, -1);
                return [...head, { ...last, content: assistantContent }];
              }
              return [...prev, { role: 'assistant' as const, content: assistantContent }];
            });
          } else if (ev.type === 'text_final') {
            assistantContent = ev.content;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && prev.length > 0) {
                const head = prev.slice(0, -1);
                return [...head, { ...last, content: assistantContent }];
              }
              return [...prev, { role: 'assistant' as const, content: assistantContent }];
            });
          } else if (ev.type === 'meta') {
            metaPackages = ev.packages || [];
            metaEscalate = !!ev.escalate;
            if (ev.journey) setJourney(ev.journey);
            if (typeof ev.freeTravelHref === 'string' && ev.freeTravelHref.length > 0) {
              metaFreeTravelHref = ev.freeTravelHref;
            }
          } else if (ev.type === 'error') {
            assistantContent = ev.message || '오류가 발생했습니다.';
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { role: 'assistant', content: assistantContent }];
              }
              return [...prev, { role: 'assistant', content: assistantContent }];
            });
          }
        }
      }

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        const ft = metaFreeTravelHref ?? undefined;
        if (last?.role !== 'assistant') {
          return [
            ...prev,
            {
              role: 'assistant',
              content: assistantContent || '응답이 비어 있습니다.',
              packages: metaPackages,
              escalated: metaEscalate,
              ...(ft ? { freeTravelHref: ft } : {}),
            },
          ];
        }
        return [
          ...prev.slice(0, -1),
          {
            role: 'assistant',
            content: assistantContent || last.content,
            packages: metaPackages.length ? metaPackages : last.packages,
            escalated: metaEscalate,
            ...(ft ? { freeTravelHref: ft } : {}),
          },
        ];
      });
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '죄송합니다. 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)]">
      <div className="flex-1 flex flex-col min-w-0 border-b lg:border-b-0 lg:border-r border-slate-200">
        <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#001f3f] rounded-full flex items-center justify-center text-white text-[13px] font-bold">
              AI
            </div>
            <div>
              <p className="font-semibold text-slate-800 text-[14px]">AI 여행 상담원 (실서버 스트림)</p>
              <p className="text-[11px] text-green-600">세션 {sessionId ? `${sessionId.slice(0, 8)}…` : '로딩…'}</p>
            </div>
          </div>
          <div className="flex gap-3 items-center">
            <button
              type="button"
              onClick={resetSession}
              className="text-[12px] text-slate-600 hover:text-slate-900 border border-slate-200 rounded-full px-3 py-1"
            >
              새 세션
            </button>
            <Link href="/packages" className="text-[13px] text-slate-700 hover:text-slate-900">
              상품 목록
            </Link>
            <Link href="/admin/escalations" className="text-[13px] text-slate-500 hover:text-slate-700">
              에스컬레이션
            </Link>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-3xl mx-auto w-full">
          {messages.map((mmsg, i) => (
            <div key={i} className={`flex ${mmsg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] ${mmsg.role === 'user' ? 'order-1' : ''}`}>
                {mmsg.role === 'assistant' && (
                  <div className="w-6 h-6 bg-slate-100 border border-slate-200 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-600 mb-1">
                    AI
                  </div>
                )}
                <div
                  className={`rounded-2xl px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap ${
                    mmsg.role === 'user'
                      ? 'bg-[#001f3f] text-white rounded-tr-sm'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                  }`}
                >
                  {mmsg.content}
                </div>

                {mmsg.packages && mmsg.packages.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {mmsg.packages.map((pkg) => (
                      <Link key={pkg.id} href={`/packages/${pkg.id}`}>
                        <div className="bg-white border border-slate-200 rounded-lg p-3 hover:border-slate-300 transition cursor-pointer">
                          <p className="font-medium text-slate-800 text-[13px]">{pkg.title}</p>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                            {pkg.destination && <span>{pkg.destination}</span>}
                            {pkg.duration && <span>{pkg.duration}일</span>}
                          </div>
                          {pkg.sellingPrice && (
                            <p className="text-slate-800 font-bold text-[14px] mt-1.5">
                              {pkg.sellingPrice.toLocaleString()}원
                              <span className="text-slate-500 font-normal ml-1 text-[11px]">
                                커미션 {pkg.commissionRate}% 포함
                              </span>
                            </p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}

                {mmsg.freeTravelHref && (
                  <div className="mt-3">
                    <Link
                      href={mmsg.freeTravelHref}
                      className="block w-full text-center bg-violet-600 text-white px-3 py-2.5 rounded-xl text-[13px] font-bold hover:bg-violet-700 transition"
                    >
                      🚀 내 맞춤 자유여행 일정표 짜러가기
                    </Link>
                  </div>
                )}

                {mmsg.escalated && (
                  <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800">
                    이 문의는 담당자 에스컬레이션 구간입니다.
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1">
                  <div
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <div
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <div
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="bg-white border-t border-slate-200 px-4 py-4 shrink-0">
          <form onSubmit={sendMessage} className="max-w-3xl mx-auto flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="예: 5월 오사카 3박4일 예약하고 싶어요 / 준비물 알려줘 / 환불 규정"
              className="flex-1 border border-slate-200 rounded-full px-5 py-2.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading || !sessionId}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim() || !sessionId}
              className="bg-[#001f3f] text-white px-5 py-2.5 rounded-full text-[14px] font-medium hover:bg-blue-900 disabled:bg-slate-300 transition"
            >
              전송
            </button>
          </form>
          <p className="text-center text-[11px] text-slate-500 mt-2">
            예약·준비물·정산 키워드로 단계가 바뀌며, DB `conversations.journey`에 저장됩니다 (마이그레이션 적용 후).
          </p>
        </div>
      </div>

      <aside className="w-full lg:w-80 shrink-0 bg-slate-50 overflow-y-auto p-4 text-[13px]">
        <h2 className="font-semibold text-slate-800 mb-2">고객 여정 (테스트)</h2>
        {!journey && (
          <p className="text-slate-500 text-[12px] leading-relaxed">
            메시지를 보내면 휴리스틱으로 단계가 갱신됩니다. 최종 자동화 파이프는 이 스냅샷을 구독하면 됩니다.
          </p>
        )}
        {journey && (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">현재 단계</p>
              <p className="font-mono text-[12px] bg-white border border-slate-200 rounded px-2 py-1.5">{journey.stage}</p>
              <p className="text-[10px] text-slate-400 mt-1">{journey.updated_at}</p>
            </div>
            {journey.checklist_preview.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">준비물 미리보기</p>
                <ul className="list-disc pl-4 space-y-1 text-[12px] text-slate-700">
                  {journey.checklist_preview.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {journey.automation_hints.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">자동화 힌트 (로드맵)</p>
                <ul className="list-disc pl-4 space-y-1 text-[12px] text-slate-700">
                  {journey.automation_hints.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
