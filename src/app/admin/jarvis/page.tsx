'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  actions?: Action[];
  loading?: boolean;
}

interface Action {
  type: 'booking_created' | 'customer_created' | 'booking_updated';
  data: Record<string, unknown>;
}

const ACTION_LABELS: Record<string, string> = {
  booking_created: '예약 생성됨',
  customer_created: '고객 등록됨',
  booking_updated: '예약 상태 변경됨',
};
const ACTION_COLORS: Record<string, string> = {
  booking_created: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  customer_created: 'bg-blue-50 border-blue-200 text-blue-700',
  booking_updated: 'bg-amber-50 border-amber-200 text-amber-700',
};

const QUICK_COMMANDS = [
  '이번달 예약 현황 알려줘',
  '장가계 상품 추천해줘',
  '미확정 예약 목록 보여줘',
  '최근 등록 고객 조회해줘',
];

function ActionCard({ action }: { action: Action }) {
  const label = ACTION_LABELS[action.type] || action.type;
  const colorClass = ACTION_COLORS[action.type] || 'bg-slate-50 border-slate-200 text-slate-700';

  const renderData = () => {
    const d = action.data as Record<string, string | number | null | undefined>;
    if (action.type === 'booking_created' && d) {
      return (
        <div className="text-[11px] mt-1 space-y-0.5">
          {d.booking_no && <p>예약번호: <strong>{d.booking_no as string}</strong></p>}
          {d.package_title && <p>상품: {d.package_title as string}</p>}
          {d.departure_date && <p>출발: {d.departure_date as string}</p>}
          {d.total_price && <p>금액: {(d.total_price as number).toLocaleString()}원</p>}
        </div>
      );
    }
    if (action.type === 'customer_created' && d) {
      return (
        <div className="text-[11px] mt-1 space-y-0.5">
          {d.name && <p>이름: <strong>{d.name as string}</strong></p>}
          {d.phone && <p>전화: {d.phone as string}</p>}
        </div>
      );
    }
    if (action.type === 'booking_updated' && d) {
      const statusMap: Record<string, string> = { confirmed: '확정', completed: '완료', cancelled: '취소' };
      return <p className="text-[11px] mt-1">상태: <strong>{statusMap[d.status as string] || d.status as string}</strong></p>;
    }
    return null;
  };

  return (
    <div className={`border rounded-lg px-3 py-2 text-[13px] font-medium ${colorClass}`}>
      {label}
      {renderData()}
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} gap-2`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-[#001f3f] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 mt-0.5">
          J
        </div>
      )}
      <div className="max-w-[75%] space-y-2">
        <div className={`px-4 py-3 rounded-2xl text-[14px] leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-[#001f3f] text-white rounded-br-md'
            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md'
        }`}>
          {msg.loading ? (
            <span className="flex items-center gap-2 text-slate-400">
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          ) : msg.content}
        </div>
        {msg.actions && msg.actions.length > 0 && (
          <div className="space-y-1.5">
            {msg.actions.map((action, i) => (
              <ActionCard key={i} action={action} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function JarvisPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '안녕하세요! 자비스입니다.\n\n예약 생성, 고객 조회, 상품 추천 등 무엇이든 말씀해주세요.\n\n예시: "김봉자 3월17, 장가계 100만원/인"',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', content: text.trim() };
    const loadingMsg: Message = { role: 'assistant', content: '', loading: true };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setIsLoading(true);

    const history = messages.map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch('/api/jarvis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          history,
          screenContext: {
            currentPage: window.location.pathname,
          },
        }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || '처리 실패');

      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: data.reply, actions: data.actions },
      ]);
    } catch (err) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: 'assistant', content: `오류가 발생했습니다: ${err instanceof Error ? err.message : '알 수 없는 오류'}` },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [isLoading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[16px] font-bold text-slate-800">자비스 AI</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">자연어로 예약/고객/상품을 처리하는 AI 비서</p>
        </div>
        <button
          onClick={() => setMessages([{
            role: 'assistant',
            content: '대화를 초기화했습니다. 무엇을 도와드릴까요?',
          }])}
          className="text-[13px] text-slate-500 hover:text-slate-700 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition bg-white"
        >
          대화 초기화
        </button>
      </div>

      {/* 메시지 영역 */}
      <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200 p-4 space-y-4">
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 빠른 명령 */}
      <div className="flex gap-2 mt-3 flex-wrap">
        {QUICK_COMMANDS.map(cmd => (
          <button
            key={cmd}
            onClick={() => send(cmd)}
            disabled={isLoading}
            className="text-[13px] px-3 py-1.5 bg-white border border-slate-200 rounded-full text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition disabled:opacity-50"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* 입력 영역 */}
      <div className="flex gap-2 mt-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='예: "김봉자 3월17, 장가계 100만원/인" 또는 "이번달 예약 현황"'
          rows={2}
          disabled={isLoading}
          className="flex-1 border border-slate-300 rounded-lg px-4 py-3 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-50"
        />
        <button
          onClick={() => send(input)}
          disabled={isLoading || !input.trim()}
          className="px-5 bg-[#001f3f] text-white rounded-lg font-medium text-[14px] hover:bg-blue-900 disabled:bg-slate-300 disabled:cursor-not-allowed transition flex items-center gap-1.5"
        >
          전송
        </button>
      </div>
      <p className="text-[13px] text-slate-400 mt-1.5">Enter로 전송 / Shift+Enter 줄바꿈</p>
    </div>
  );
}
