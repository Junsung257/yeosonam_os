'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useChatStore, type ChatMessage } from '@/lib/chat-store';
import { getReferrer } from '@/lib/tracker';
import { MessageCircle, X, Send } from 'lucide-react';

export default function ChatWidget() {
  const pathname = usePathname();
  const { isOpen, messages, isTyping, toggleChat, closeChat } = useChatStore();

  // admin 페이지에서는 자비스 플로팅 위젯을 사용하므로 숨김
  if (pathname.startsWith('/admin')) return null;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState('');

  // 메시지 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // 채팅 열릴 때 input 포커스
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text) return;
    setInputValue('');

    // 사용자 메시지 추가
    useChatStore.getState().addMessage({
      role: 'user',
      content: text,
      type: 'text',
    });

    // AI 응답 (Phase 5에서 /api/qa/chat 연동 예정)
    useChatStore.getState().setTyping(true);

    try {
      const { sessionId } = useChatStore.getState();
      const data = await sendToChat(text, sessionId);
      addChatResponse(data);
    } catch {
      useChatStore.getState().addMessage({
        role: 'assistant',
        content: '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        type: 'text',
      });
    } finally {
      useChatStore.getState().setTyping(false);
    }
  };

  const handleQuickButton = (text: string) => {
    setInputValue('');
    useChatStore.getState().addMessage({ role: 'user', content: text, type: 'text' });
    callChat(text);
  };

  async function callChat(text: string) {
    useChatStore.getState().setTyping(true);
    try {
      const { sessionId } = useChatStore.getState();
      const data = await sendToChat(text, sessionId);
      addChatResponse(data);
    } catch {
      useChatStore.getState().addMessage({
        role: 'assistant',
        content: '네트워크 오류가 발생했습니다.',
        type: 'text',
      });
    } finally {
      useChatStore.getState().setTyping(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* 플로팅 버튼 */}
      {!isOpen && (
        <button
          onClick={toggleChat}
          className="fixed bottom-6 right-6 w-14 h-14 bg-violet-600 hover:bg-violet-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all z-50 active:scale-95"
          aria-label="채팅 열기"
        >
          <MessageCircle size={26} />
        </button>
      )}

      {/* 채팅 창 */}
      {isOpen && (
        <div className="fixed bottom-0 right-0 md:bottom-6 md:right-6 w-full md:w-96 h-full md:h-[600px] md:max-h-[80vh] bg-white md:rounded-2xl shadow-2xl flex flex-col z-50 border border-gray-200">
          {/* 헤더 */}
          <div className="bg-violet-600 text-white px-4 py-3 md:rounded-t-2xl flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center">
                <MessageCircle size={20} />
              </div>
              <div>
                <div className="font-bold text-sm">여소남 상담</div>
                <div className="text-[10px] text-white/80">AI가 도와드립니다</div>
              </div>
            </div>
            <button onClick={closeChat} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition">
              <X size={20} />
            </button>
          </div>

          {/* 메시지 영역 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-violet-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MessageCircle size={32} className="text-violet-400" />
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">궁금하신 점을 물어보세요!</p>
                <p className="text-xs text-gray-400 mb-6">여행 상담부터 상품 추천까지</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {['다낭 추천 상품', '오사카 3박4일', '가격 문의'].map((q) => (
                    <button
                      key={q}
                      onClick={() => handleQuickButton(q)}
                      className="px-3 py-1.5 bg-violet-50 text-violet-700 text-xs rounded-full hover:bg-violet-100 transition"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onButtonClick={handleQuickButton} />
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 입력 영역 */}
          <div className="border-t border-gray-100 p-3 shrink-0 safe-area-bottom">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="메시지를 입력하세요..."
                className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 resize-none text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 max-h-24"
                rows={1}
                onKeyDown={handleKeyDown}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className="w-10 h-10 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-xl flex items-center justify-center transition shrink-0"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── API 호출 + 응답 처리 헬퍼 ──────────────────────────

async function sendToChat(text: string, sessionId: string) {
  const res = await fetch('/api/qa/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: text,
      sessionId,
      referrer: getReferrer(),
      history: useChatStore.getState().messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });
  if (!res.ok) throw new Error('Chat API failed');
  return res.json();
}

function addChatResponse(data: { reply?: string; packages?: any[]; escalate?: boolean; error?: string }) {
  const { addMessage } = useChatStore.getState();

  // 추천 상품이 있으면 product_cards 타입으로 렌더링
  if (data.packages && data.packages.length > 0) {
    addMessage({
      role: 'assistant',
      content: data.reply || '추천 상품입니다.',
      type: 'product_cards',
      products: data.packages.map((p: any) => ({
        id: p.id,
        title: p.title,
        destination: p.destination,
        duration: p.duration,
        price: p.sellingPrice || p.price,
      })),
    });
  } else {
    addMessage({
      role: 'assistant',
      content: data.reply || data.error || '죄송합니다. 다시 시도해주세요.',
      type: 'text',
    });
  }

  // 에스컬레이션 안내
  if (data.escalate) {
    addMessage({
      role: 'assistant',
      content: '더 정확한 안내를 위해 전문 상담사와 연결해드릴까요?',
      type: 'buttons',
      buttons: ['전화 상담 요청', '카카오톡 상담'],
    });
  }
}

function MessageBubble({ message, onButtonClick }: { message: ChatMessage; onButtonClick: (text: string) => void }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'bg-violet-600 text-white rounded-br-sm'
            : 'bg-gray-100 text-gray-900 rounded-bl-sm'
        }`}
      >
        {/* 텍스트 메시지 */}
        {(!message.type || message.type === 'text') && (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
        )}

        {/* 상품 카드 */}
        {message.type === 'product_cards' && message.products && (
          <div className="space-y-2">
            <p className="text-sm mb-2">{message.content}</p>
            {message.products.map((product) => (
              <a
                key={product.id}
                href={`/products/${product.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-white rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="font-semibold text-sm text-gray-900">{product.destination || product.title}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {product.nights ? `${product.nights}박${product.nights + 1}일` : product.duration ? `${product.duration}일` : ''}
                </div>
                <div className="text-sm font-bold text-violet-600 mt-1.5">
                  ₩{(product.price || 0).toLocaleString()}~
                </div>
              </a>
            ))}
          </div>
        )}

        {/* 버튼형 */}
        {message.type === 'buttons' && message.buttons && (
          <div>
            <p className="text-sm mb-2">{message.content}</p>
            <div className="space-y-1.5">
              {message.buttons.map((btn, idx) => (
                <button
                  key={idx}
                  onClick={() => onButtonClick(btn)}
                  className="w-full bg-white text-violet-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-violet-50 transition text-left"
                >
                  {btn}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={`text-[10px] mt-1 ${isUser ? 'text-white/60' : 'text-gray-400'}`}>
          {message.timestamp.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
