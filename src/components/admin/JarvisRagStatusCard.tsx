/**
 * Jarvis V2 RAG 색인 상태 카드 — /admin/jarvis 페이지용 (v4, 2026-04-30).
 */
'use client';

import { useEffect, useState } from 'react';

interface Status {
  total_chunks: number;
  by_source: Record<string, number>;
  last_indexed_at: string | null;
  bot_profiles: number;
  rag_ready: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  package: '📦 상품',
  blog: '📝 블로그',
  attraction: '🗺️ 관광지',
  policy: '📋 정책',
  custom: '✨ 기타',
};

export default function JarvisRagStatusCard() {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch('/api/admin/jarvis/rag-status')
      .then(r => r.ok ? r.json() : null)
      .then(setStatus)
      .catch(() => {});
  }, []);

  if (!status) return null;

  const total = status.total_chunks;
  const ready = status.rag_ready;

  return (
    <section className={`rounded-xl border p-4 ${
      ready ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <span>🧠</span>
          <span>자비스 RAG 색인 상태</span>
        </h3>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
          ready ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'
        }`}>
          {ready ? '✓ Ready' : '⚠️ 인덱싱 필요'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <Kpi label="총 chunks" value={total.toLocaleString()} highlight={ready} />
        <Kpi label="봇 페르소나" value={`${status.bot_profiles}건`} />
        <Kpi label="마지막 인덱싱"
          value={status.last_indexed_at
            ? new Date(status.last_indexed_at).toLocaleDateString('ko-KR')
            : '없음'} />
        <Kpi label="RAG 검색" value={ready ? '활성' : '비활성'} />
      </div>

      {Object.keys(status.by_source).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(status.by_source).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 text-[11px] bg-white border border-slate-200 px-2 py-0.5 rounded-full">
              <span>{SOURCE_LABELS[k] ?? k}</span>
              <span className="font-bold tabular-nums">{v}</span>
            </span>
          ))}
        </div>
      )}

      {!ready && (
        <p className="text-[11px] text-amber-700 mt-3 leading-relaxed">
          💡 자비스 컨시어지가 상품·블로그·관광지 정보를 검색하려면 RAG 인덱싱이 필요해요.<br />
          실행: <code className="bg-white px-1 py-0.5 rounded text-[10px]">node db/rag_reindex_all.js</code>
        </p>
      )}
    </section>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-2.5 border ${highlight ? 'bg-white border-emerald-300' : 'bg-white border-slate-200'}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-base font-extrabold mt-0.5 tabular-nums ${highlight ? 'text-emerald-700' : 'text-slate-700'}`}>
        {value}
      </div>
    </div>
  );
}
