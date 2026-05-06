'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';

// ── 타입 정의 ────────────────────────────────────────────────────────────────
interface RfqMessage {
  id: string;
  sender_type: 'customer' | 'tenant' | 'ai' | 'system';
  processed_content: string;
  raw_content: string;
  pii_blocked: boolean;
  is_visible_to_customer: boolean;
  created_at: string;
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function RfqChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const proposalId = searchParams.get('proposal_id') ?? '';

  const bottomRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<RfqMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 최초 로드
  useEffect(() => {
    fetchMessages();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/id-trigger-only intentional
  }, [id]);

  // 10초 폴링
  useEffect(() => {
    const interval = setInterval(fetchMessages, 10000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/id-trigger-only intentional
  }, [id]);

  // 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function fetchMessages() {
    try {
      const res = await fetch(`/api/rfq/${id}/messages?viewAs=customer`);
      if (!res.ok) throw new Error('메시지를 불러올 수 없습니다');
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');

    // 낙관적 업데이트
    const optimistic: RfqMessage = {
      id: `temp-${Date.now()}`,
      sender_type: 'customer',
      raw_content: text,
      processed_content: text,
      pii_blocked: false,
      is_visible_to_customer: true,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      await fetch(`/api/rfq/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_type: 'customer',
          raw_content: text,
          proposal_id: proposalId || undefined,
        }),
      });
      await fetchMessages();
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      alert('메시지 전송 중 오류가 발생했습니다.');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function fmtTime(s: string) {
    return new Date(s).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b sticky top-0 z-10 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href={`/rfq/${id}`} className="text-gray-400 hover:text-gray-600 text-sm">
            ←
          </Link>
          <div>
            <h1 className="font-semibold text-gray-900">💬 AI 중개 채팅</h1>
            <p className="text-xs text-gray-500">RFQ #{id.slice(0, 8)}</p>
          </div>
        </div>
      </div>

      {/* 안내 배너 */}
      <div className="bg-gray-100 border-b px-4 py-2">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs text-gray-600 leading-relaxed">
            🛡️ 고객님과 여행사 간 모든 소통은 AI가 중개합니다. 개인정보 보호를 위해 상대방 연락처는 노출되지 않습니다.
          </p>
        </div>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-3">
          {loading && (
            <div className="text-center text-gray-400 text-sm py-8">메시지를 불러오는 중...</div>
          )}
          {error && (
            <div className="text-center text-red-500 text-sm py-4">{error}</div>
          )}

          {!loading && messages.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-12">
              <p className="text-2xl mb-2">💬</p>
              <p>아직 메시지가 없습니다.</p>
              <p className="text-xs mt-1">첫 메시지를 보내보세요.</p>
            </div>
          )}

          {messages.map((msg) => {
            const isCustomer = msg.sender_type === 'customer';
            const isSystem = msg.sender_type === 'ai' || msg.sender_type === 'system';

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center">
                  <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                    {msg.processed_content}
                  </span>
                </div>
              );
            }

            if (msg.pii_blocked) {
              return (
                <div
                  key={msg.id}
                  className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="max-w-[75%] bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-1.5 text-yellow-700 text-sm">
                      <span>⚠️</span>
                      <span className="font-medium">개인정보 보호를 위해 차단됨</span>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[75%]">
                  <div
                    className={`px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                      isCustomer
                        ? 'bg-brand text-white rounded-tr-sm'
                        : 'bg-white border text-gray-800 rounded-tl-sm shadow-sm'
                    }`}
                  >
                    {msg.processed_content}
                  </div>
                  <div
                    className={`flex items-center gap-1 mt-1 ${
                      isCustomer ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <span className="text-xs text-gray-400">{fmtTime(msg.created_at)}</span>
                    {!isCustomer && (
                      <span className="text-xs text-gray-400 italic">AI가 번역·정제한 내용입니다</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* 입력 영역 */}
      <div className="border-t bg-white px-4 py-3 sticky bottom-0">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            placeholder="메시지를 입력하세요... (Enter: 전송, Shift+Enter: 줄바꿈)"
            rows={2}
            className="flex-1 resize-none border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={sending || !input.trim()}
            className="bg-brand hover:bg-[#1B64DA] disabled:opacity-40 text-white px-5 py-3 rounded-xl font-medium transition-colors"
          >
            {sending ? '...' : '전송'}
          </button>
        </div>
      </div>
    </div>
  );
}
