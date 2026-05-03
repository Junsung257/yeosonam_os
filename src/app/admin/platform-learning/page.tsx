'use client';

import { useEffect, useState, useCallback } from 'react';

type Row = {
  id: string;
  created_at: string;
  source: string;
  session_id: string | null;
  tenant_id: string | null;
  affiliate_id: string | null;
  message_sha256: string | null;
  message_redacted: string | null;
  payload: Record<string, unknown>;
  consent_flags: Record<string, unknown>;
};

export default function PlatformLearningPage() {
  const [events, setEvents] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 40;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (source) q.set('source', source);
      const res = await fetch(`/api/admin/platform-learning?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '로드 실패');
      setEvents(json.events ?? []);
      setTotal(json.total ?? 0);
      setNotice(json.notice ?? null);
    } catch {
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [offset, source]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">AI 플라이휠 이벤트</h1>
        <p className="text-sm text-slate-500 mt-1">
          QA 채팅·자비스 턴마다 적재되는 구조 신호입니다. 원문은 해시만 저장하며,{' '}
          <code className="text-xs bg-slate-100 px-1 rounded">PLATFORM_LEARNING_STORE_REDACTED_MESSAGE=true</code>일 때
          마스킹 전문이 함께 저장됩니다.
        </p>
        {notice && (
          <p className="text-amber-700 text-sm mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{notice}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select
          value={source}
          onChange={(e) => {
            setOffset(0);
            setSource(e.target.value);
          }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">전체 소스</option>
          <option value="qa_chat">qa_chat</option>
          <option value="qa_escalation_cta">qa_escalation_cta</option>
          <option value="jarvis_v1">jarvis_v1</option>
          <option value="jarvis_v2_stream">jarvis_v2_stream</option>
        </select>
        <span className="text-sm text-slate-500">총 {total}건</span>
        <button
          type="button"
          onClick={() => load()}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50"
        >
          새로고침
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      ) : events.length === 0 ? (
        <p className="text-slate-500 text-sm">데이터가 없거나 테이블이 아직 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="border border-slate-200 rounded-xl p-4 bg-white text-sm shadow-sm"
            >
              <div className="flex flex-wrap gap-2 text-xs text-slate-500 mb-2">
                <span className="font-mono text-slate-800">{ev.source}</span>
                <span>{new Date(ev.created_at).toLocaleString('ko-KR')}</span>
                {ev.tenant_id && <span>tenant: {ev.tenant_id.slice(0, 8)}…</span>}
                {ev.affiliate_id && <span>affiliate: {ev.affiliate_id.slice(0, 8)}…</span>}
                {ev.message_sha256 && (
                  <span className="truncate max-w-[200px]" title={ev.message_sha256}>
                    sha256: {ev.message_sha256.slice(0, 12)}…
                  </span>
                )}
              </div>
              {ev.message_redacted && (
                <p className="text-slate-700 text-xs mb-2 whitespace-pre-wrap border-l-2 border-violet-200 pl-2">
                  {ev.message_redacted}
                </p>
              )}
              <pre className="text-[11px] bg-slate-50 rounded-lg p-2 overflow-x-auto text-slate-700">
                {JSON.stringify(ev.payload, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}

      {total > offset + limit && (
        <button
          type="button"
          className="mt-4 text-sm text-violet-700 hover:underline"
          onClick={() => setOffset((o) => o + limit)}
        >
          더 보기 (다음 {limit}건)
        </button>
      )}
      {offset > 0 && (
        <button
          type="button"
          className="mt-2 ml-3 text-sm text-slate-600 hover:underline"
          onClick={() => setOffset((o) => Math.max(0, o - limit))}
        >
          이전 페이지
        </button>
      )}
    </div>
  );
}
