'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

interface RecommendedPackage {
  id: string;
  title: string;
  destination?: string;
  duration?: number;
  price?: number;
  sellingPrice?: number;
  commissionRate?: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  packages?: RecommendedPackage[];
  escalated?: boolean;
}

export default function QAPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '안녕하세요! 여소남 여행사 AI 상담원입니다. 여행 목적지, 예산, 인원, 기간을 알려주시면 최적의 상품을 추천해드립니다. 😊',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || isLoading) return;

    const userMessage: Message = { role: 'user', content: msg };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const history = newMessages.slice(1).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/qa/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI 응답 실패');

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.reply,
        packages: data.packages ?? [],
        escalated: data.escalate ?? false,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '죄송합니다. 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      }]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center text-white text-lg">🤖</div>
          <div>
            <p className="font-semibold text-gray-900">AI 여행 상담원</p>
            <p className="text-xs text-green-500">온라인</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Link href="/packages" className="text-sm text-blue-600 hover:underline">상품 목록</Link>
          <Link href="/admin/escalations" className="text-sm text-gray-500 hover:text-gray-700">담당자 문의 관리</Link>
        </div>
      </div>

      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4 max-w-3xl mx-auto w-full">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] ${msg.role === 'user' ? 'order-1' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center text-sm mb-1">🤖</div>
              )}
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-sm'
                  : 'bg-white shadow-sm border border-gray-100 text-gray-800 rounded-tl-sm'
              }`}>
                {msg.content}
              </div>

              {/* 추천 패키지 카드 */}
              {msg.packages && msg.packages.length > 0 && (
                <div className="mt-3 space-y-2">
                  {msg.packages.map(pkg => (
                    <Link key={pkg.id} href={`/packages/${pkg.id}`}>
                      <div className="bg-white border border-blue-200 rounded-xl p-3 hover:shadow-md transition cursor-pointer">
                        <p className="font-medium text-gray-900 text-sm">{pkg.title}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          {pkg.destination && <span>📍 {pkg.destination}</span>}
                          {pkg.duration && <span>🗓 {pkg.duration}일</span>}
                        </div>
                        {pkg.sellingPrice && (
                          <p className="text-blue-700 font-bold mt-1.5">
                            {pkg.sellingPrice.toLocaleString()}원
                            <span className="text-gray-400 font-normal ml-1 text-xs">커미션 {pkg.commissionRate}% 포함</span>
                          </p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {/* 에스컬레이션 알림 */}
              {msg.escalated && (
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                  ⚠️ 이 문의는 담당자에게 전달되었습니다.
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white shadow-sm border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력 영역 */}
      <div className="bg-white border-t px-4 py-4">
        <form onSubmit={sendMessage} className="max-w-3xl mx-auto flex gap-3">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="예: 5월에 오사카 3박4일, 2명, 예산 150만원"
            className="flex-1 border border-gray-300 rounded-full px-5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 transition"
          >
            전송
          </button>
        </form>
        <p className="text-center text-xs text-gray-400 mt-2">
          예약 확정·단체 견적·환불 문의는 담당자에게 자동 연결됩니다
        </p>
      </div>
    </div>
  );
}
