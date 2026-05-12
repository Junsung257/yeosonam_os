'use client';

/**
 * MagicLinkChat — 매직링크 게스트 진입용 자비스 채팅 위젯.
 *
 * 설계 결정:
 *   - 모바일 우선. 화면 전체를 챗 UI 로 채움.
 *   - V2 SSE 스트리밍 (useJarvisStream 재사용).
 *   - 시작 시 컨텍스트 기반 인사 + Quick Reply 3개 (글로벌 OTA 패턴).
 *   - Generative UI v1: pendingAction 발생 시 "확인이 필요해요" 카드 + 상세 화면 링크.
 *     실제 generative UI (폼·결제카드 inline 렌더링) 는 S6 에서 확장.
 *   - 자비스 발언은 "이건 확정 답변이 아닐 수 있어요. 정확한 정보는 담당자에게 확인 부탁드려요."
 *     이라는 가드 텍스트를 매 응답 하단에 노출 (Air Canada 패턴 명시 회피).
 */

import { useEffect, useRef, useState } from 'react';
import { useJarvisStream } from '@/lib/jarvis/useJarvisStream';

export interface MagicLinkChatContext {
  bookingNo?: string | null;
  bookingDestination?: string | null;
  bookingDepartureDate?: string | null;
  customerName?: string | null;
  actionLabel?: string | null;
  /** 자비스가 첫 메시지에 참조할 액션 종류 — system prompt 분기 신호 */
  actionType?: string;
}

interface ChatBubble {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string | null;
  pendingAction?: {
    id: string;
    description: string;
    riskLevel: 'low' | 'medium' | 'high';
  } | null;
  isStreaming?: boolean;
}

const DEFAULT_QUICK_REPLIES = [
  '내 예약 정보 확인',
  '일정 다시 보내줘',
  '여행 준비물 알려줘',
];

interface Props {
  context: MagicLinkChatContext;
  greeting?: string;
  quickReplies?: string[];
}

export default function MagicLinkChat({
  context,
  greeting,
  quickReplies = DEFAULT_QUICK_REPLIES,
}: Props) {
  const stream = useJarvisStream({});
  const [bubbles, setBubbles] = useState<ChatBubble[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      content: greeting ?? buildDefaultGreeting(context),
    },
  ]);
  const [input, setInput] = useState('');
  const [showQuickReplies, setShowQuickReplies] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 스트리밍 중인 어시스턴트 메시지 — text 가 늘어날 때마다 마지막 bubble 업데이트
  useEffect(() => {
    if (!stream.streaming && !stream.text) return;
    setBubbles((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && last.isStreaming) {
        return [
          ...prev.slice(0, -1),
          {
            ...last,
            content: stream.text,
            agent: stream.agent ?? last.agent,
            pendingAction: stream.pendingAction
              ? {
                  id: stream.pendingAction.id,
                  description: stream.pendingAction.description,
                  riskLevel: stream.pendingAction.riskLevel,
                }
              : last.pendingAction,
          },
        ];
      }
      return prev;
    });
  }, [stream.text, stream.streaming, stream.agent, stream.pendingAction]);

  // 스트리밍 종료 시 isStreaming 플래그 해제
  useEffect(() => {
    if (!stream.streaming) {
      setBubbles((prev) =>
        prev.map((b) => (b.isStreaming ? { ...b, isStreaming: false } : b)),
      );
    }
  }, [stream.streaming]);

  // 새 메시지 도착 시 스크롤 하단
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || stream.streaming) return;

    setShowQuickReplies(false);
    setInput('');

    const userBubble: ChatBubble = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    const assistantBubble: ChatBubble = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };
    setBubbles((prev) => [...prev, userBubble, assistantBubble]);

    await stream.send(trimmed);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-bold">
            여
          </div>
          <div>
            <div className="font-semibold text-sm text-gray-900">여소남 안내</div>
            <div className="text-xs text-gray-500">
              {context.actionLabel ?? '예약·일정 안내'}
            </div>
          </div>
        </div>
        <span className="text-[10px] text-gray-400">AI 응답</span>
      </header>

      {/* 메시지 영역 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
        aria-live="polite"
      >
        {bubbles.map((b) => (
          <ChatBubbleView key={b.id} bubble={b} />
        ))}

        {stream.streaming && bubbles[bubbles.length - 1]?.content === '' && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-gray-500">
              <TypingDots />
            </div>
          </div>
        )}

        {stream.error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            오류가 발생했어요. 잠시 후 다시 시도하시거나, 안내 메시지의 번호로 연락 주세요. ({stream.error})
          </div>
        )}
      </div>

      {/* Quick Replies */}
      {showQuickReplies && !stream.streaming && (
        <div className="px-4 pb-2 flex gap-2 overflow-x-auto">
          {quickReplies.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              className="flex-shrink-0 text-sm text-gray-700 bg-white border border-gray-200 rounded-full px-4 py-2 hover:bg-gray-100 active:bg-gray-200"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* 입력 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="bg-white border-t border-gray-200 p-3 flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={stream.streaming}
          placeholder="메시지를 입력하세요"
          className="flex-1 bg-gray-100 rounded-full px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!input.trim() || stream.streaming}
          className="bg-gray-900 text-white rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800"
        >
          전송
        </button>
      </form>

      {/* 가드 텍스트 (Air Canada 패턴 명시 회피) */}
      <p className="text-[10px] text-gray-400 text-center px-4 pb-2 bg-white">
        AI 답변은 참고용입니다. 결제·환불·약관 등 확정 안내는 담당자에게 직접 확인해 주세요.
      </p>
    </div>
  );
}

function ChatBubbleView({ bubble }: { bubble: ChatBubble }) {
  if (bubble.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-gray-900 text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm max-w-[80%] whitespace-pre-wrap leading-relaxed">
          {bubble.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
          {bubble.content}
        </div>
        {bubble.pendingAction && (
          <PendingActionCard pa={bubble.pendingAction} />
        )}
      </div>
    </div>
  );
}

function PendingActionCard({
  pa,
}: {
  pa: { id: string; description: string; riskLevel: 'low' | 'medium' | 'high' };
}) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs">
      <div className="font-semibold text-amber-900 mb-1">담당자 확인이 필요해요</div>
      <div className="text-amber-800 leading-relaxed">{pa.description}</div>
      <div className="text-[10px] text-amber-700 mt-2">
        요청을 접수했어요. 담당자가 확인 후 카카오톡으로 연락드릴 예정이에요.
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1" aria-label="응답 작성 중">
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}

function buildDefaultGreeting(ctx: MagicLinkChatContext): string {
  const name = ctx.customerName ? `${ctx.customerName}님, ` : '';
  const dest = ctx.bookingDestination ? `${ctx.bookingDestination} ` : '';
  const date = ctx.bookingDepartureDate ? `(${ctx.bookingDepartureDate} 출발) ` : '';
  const action = ctx.actionLabel ? ctx.actionLabel : '여행';

  const head = `${name}안녕하세요. 여소남 안내입니다.`;
  const body = `${dest}${date}${action} 관련해서 궁금한 점을 자유롭게 물어봐 주세요.`;
  const tip = '예약 정보·일정·준비물·현지 정보 등을 안내해 드려요.';
  return [head, body, '', tip].join('\n');
}
