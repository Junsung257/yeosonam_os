'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

// ── 타입 정의 ────────────────────────────────────────────────────────────────
interface Message {
  role: 'user' | 'ai';
  content: string;
}

interface InterviewState {
  messages: unknown[];
  extracted: Record<string, unknown>;
  isComplete: boolean;
  stepsDone: string[];
}

// ── 수집 필드 정의 ────────────────────────────────────────────────────────────
const FIELDS = [
  { key: 'destination', label: '목적지' },
  { key: 'people', label: '인원' },
  { key: 'budget', label: '예산' },
  { key: 'dates', label: '여행일자' },
  { key: 'hotel', label: '호텔등급' },
  { key: 'meal', label: '식사' },
  { key: 'transport', label: '교통' },
  { key: 'special', label: '특별요청' },
];

const INITIAL_AI_MESSAGE =
  '안녕하세요! 단체여행 전문 컨시어지 AI입니다. 어떤 여행을 계획하고 계신가요? 목적지부터 알려주시면 최적의 랜드사를 연결해 드릴게요. 😊';

const fmt = (n: number) => n.toLocaleString('ko-KR');

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function GroupInquiryPage() {
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', content: INITIAL_AI_MESSAGE },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [interviewState, setInterviewState] = useState<InterviewState>({
    messages: [],
    extracted: {},
    isComplete: false,
    stepsDone: [],
  });
  const [rfqReady, setRfqReady] = useState(false);
  const [extractedSummary, setExtractedSummary] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  // 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 진행률 계산
  const collectedCount = FIELDS.filter(
    (f) => interviewState.extracted[f.key] !== undefined && interviewState.extracted[f.key] !== null
  ).length;
  const progressPct = Math.round((collectedCount / FIELDS.length) * 100);

  // 메시지 전송
  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/rfq/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, state: interviewState }),
      });
      if (!res.ok) throw new Error('API 오류');
      const data = await res.json();

      setMessages([...newMessages, { role: 'ai', content: data.reply }]);
      setInterviewState(data.state);

      if (data.state.isComplete) {
        setRfqReady(true);
        setExtractedSummary(data.state.extracted);
      }
    } catch {
      setMessages([
        ...newMessages,
        { role: 'ai', content: '죄송합니다, 잠시 후 다시 시도해 주세요.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // RFQ 공고 등록
  async function registerRfq() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/rfq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extractedSummary),
      });
      if (!res.ok) throw new Error('등록 실패');
      const data = await res.json();
      router.push(`/rfq/${data.id}`);
    } catch {
      alert('공고 등록 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* 헤더 */}
      <div className="border-b bg-white sticky top-0 z-10 px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-xl font-bold text-gray-900">✈️ 단체여행 견적 요청</h1>
          <p className="text-sm text-gray-500 mt-0.5">AI가 필요한 정보를 안내해 드립니다</p>

          {/* 진행률 바 */}
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>정보 수집 진행률</span>
              <span>{collectedCount}/{FIELDS.length} 항목 완료</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#3182F6] rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {FIELDS.map((f) => {
                const collected =
                  interviewState.extracted[f.key] !== undefined &&
                  interviewState.extracted[f.key] !== null;
                return (
                  <span
                    key={f.key}
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      collected
                        ? 'bg-[#EBF3FE] text-[#3182F6]'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {collected ? '✓ ' : ''}{f.label}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'ai' && (
                <div className="w-8 h-8 rounded-full bg-[#EBF3FE] flex items-center justify-center text-sm mr-2 mt-1 flex-shrink-0">
                  🤖
                </div>
              )}
              <div
                className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-[#3182F6] text-white rounded-tr-sm'
                    : 'bg-[#F8FAFC] text-[#191F28] rounded-tl-sm'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="w-8 h-8 rounded-full bg-[#EBF3FE] flex items-center justify-center text-sm mr-2 flex-shrink-0">
                🤖
              </div>
              <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-tl-sm">
                <span className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          )}

          {/* RFQ 요약 카드 */}
          {rfqReady && (
            <div className="bg-white border border-[#DBEAFE] shadow-sm rounded-xl p-5 mt-4">
              <h3 className="font-semibold text-gray-900 mb-3">📋 수집된 여행 요건 요약</h3>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                {[
                  { label: '목적지', key: 'destination' },
                  { label: '인원', key: 'people' },
                  { label: '예산', key: 'budget' },
                  { label: '여행일자', key: 'dates' },
                  { label: '호텔등급', key: 'hotel' },
                  { label: '식사', key: 'meal' },
                  { label: '교통', key: 'transport' },
                  { label: '특별요청', key: 'special' },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <span className="text-gray-500">{label}: </span>
                    <span className="font-medium text-gray-800">
                      {extractedSummary[key]
                        ? String(extractedSummary[key])
                        : '—'}
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={registerRfq}
                disabled={submitting}
                className="w-full bg-[#3182F6] hover:bg-[#1B64DA] disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
              >
                {submitting ? '등록 중...' : '🚀 공고 등록하기'}
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* 입력 영역 */}
      {!rfqReady && (
        <div className="border-t bg-white px-4 py-3 sticky bottom-0">
          <div className="max-w-2xl mx-auto flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="메시지를 입력하세요... (Enter: 전송, Shift+Enter: 줄바꿈)"
              rows={2}
              className="flex-1 resize-none border border-[#E5E7EB] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#3182F6]/30 disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="bg-[#3182F6] hover:bg-[#1B64DA] disabled:opacity-40 text-white px-5 py-3 rounded-xl font-medium transition-colors"
            >
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
