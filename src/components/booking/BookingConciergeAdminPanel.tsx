'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Row = {
  id: string;
  role: string;
  content: string;
  metadata?: { by?: string } | null;
  created_at: string;
};

export default function BookingConciergeAdminPanel(props: {
  bookingId: string;
  /** 데스크톱 등 상위에서 토스트를 쓸 때 전달. 없으면 패널 내부 잠깐 메시지로 표시 */
  onToast?: (msg: string) => void;
}) {
  const { bookingId, onToast } = props;
  const [rows, setRows] = useState<Row[]>([]);
  const [aiPaused, setAiPaused] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const toast = useCallback(
    (msg: string) => {
      onToast?.(msg);
      setFlash(msg);
      window.setTimeout(() => setFlash(null), 2800);
    },
    [onToast],
  );

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/bookings/${bookingId}/concierge-messages`, {
      credentials: 'include',
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoadErr((j as { error?: string }).error ?? '불러오기 실패');
      return;
    }
    setLoadErr(null);
    setRows((j as { messages?: Row[] }).messages ?? []);
    if (typeof (j as { aiPaused?: boolean }).aiPaused === 'boolean') {
      setAiPaused(Boolean((j as { aiPaused?: boolean }).aiPaused));
    }
  }, [bookingId]);

  async function patchAiPaused(next: boolean) {
    if (togglingPause) return;
    setTogglingPause(true);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/concierge-messages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ aiPaused: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast((j as { error?: string }).error ?? '설정 변경 실패');
        return;
      }
      setAiPaused(Boolean((j as { aiPaused?: boolean }).aiPaused));
      toast(next ? 'AI 자동 답변을 껐습니다. (상담 모드)' : 'AI 자동 답변을 켰습니다.');
    } finally {
      setTogglingPause(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [rows]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/concierge-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: text }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast((j as { error?: string }).error ?? '전송 실패');
        return;
      }
      setDraft('');
      await load();
      toast('고객 포털에 답변이 반영되었습니다.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-emerald-200/80 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-bold text-emerald-700 uppercase tracking-wide">포털 AI 컨시어지</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            고객이 <span className="font-mono">/trip/···</span> 링크에서 보낸 대화와 동일 스레드입니다. 아래 전송 시 고객 화면에 곧바로 보입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 shrink-0"
        >
          새로고침
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-gray-100">
        <div>
          <p className="text-[11px] font-medium text-gray-800">AI 자동 답변</p>
          <p className="text-[10px] text-gray-500">꺼두면 고객 포털에서 AI가 답하지 않고 상담만 받습니다.</p>
        </div>
        <button
          type="button"
          disabled={togglingPause}
          onClick={() => void patchAiPaused(!aiPaused)}
          className={`text-[11px] px-3 py-1.5 rounded-full border font-medium shrink-0 transition disabled:opacity-50 ${
            aiPaused
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100'
          }`}
        >
          {togglingPause ? '…' : aiPaused ? '꺼짐 · 상담 모드' : '켜짐 · AI 응답'}
        </button>
      </div>

      {flash && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1.5 mb-2">
          {flash}
        </p>
      )}

      {loadErr && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 mb-2">{loadErr}</p>
      )}

      <div className="max-h-72 overflow-y-auto space-y-2 rounded-lg border border-gray-100 bg-gray-50/80 p-2 mb-3">
        {rows.length === 0 && !loadErr && (
          <p className="text-xs text-gray-400 text-center py-6">아직 포털 대화가 없습니다.</p>
        )}
        {rows.map((m) => (
          <div
            key={m.id}
            className={`text-xs rounded-lg px-2.5 py-1.5 max-w-[95%] ${
              m.role === 'user'
                ? 'bg-blue-600 text-white ml-auto'
                : m.role === 'staff'
                  ? 'bg-amber-100 text-amber-950 border border-amber-200/80'
                  : m.role === 'assistant'
                    ? 'bg-white text-gray-800 border border-gray-200'
                    : 'bg-gray-200 text-gray-700'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-0.5 opacity-90">
              <span className="font-semibold uppercase tracking-wide text-[10px]">
                {m.role === 'user' ? '고객' : m.role === 'staff' ? '상담(내부)' : m.role === 'assistant' ? 'AI' : m.role}
              </span>
              <span className="text-[10px] tabular-nums">
                {new Date(m.created_at).toLocaleString('ko-KR', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            {m.role === 'staff' && m.metadata?.by && (
              <p className="text-[10px] opacity-80 mb-0.5">보낸 사람: {m.metadata.by}</p>
            )}
            <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="고객에게 보낼 답변 (포털 채팅에 표시)"
          rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40 resize-y min-h-[4rem]"
        />
        <div className="flex justify-end">
          <button
            type="button"
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition"
          >
            {sending ? '전송 중…' : '답변 전송'}
          </button>
        </div>
      </div>
    </div>
  );
}
