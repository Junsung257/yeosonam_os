/**
 * /admin/jarvis/rag — 자비스가 학습한 RAG 지식 직접 검색 (v6, 2026-04-30)
 *
 * 사장님이 "자비스가 X를 알고 있나?" 검증할 수 있는 운영 도구.
 * 실제 jarvis_hybrid_search RPC 를 그대로 호출해서 결과 노출.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Hit {
  source_type: string;
  source_id: string;
  source_title: string;
  source_url: string | null;
  chunk_text: string;
  contextual_text: string;
  rrf_score: number;
  vector_score: number;
  bm25_score: number;
}

const SOURCE_LABELS: Record<string, string> = {
  package: '📦 상품',
  blog: '📝 블로그',
  attraction: '🗺️ 관광지',
  policy: '📋 정책',
};

export default function JarvisRagSearchPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const sp = new URLSearchParams({ q: query.trim() });
      if (filter) sp.set('source', filter);
      const res = await fetch(`/api/admin/jarvis/rag-search?${sp}`);
      const d = await res.json();
      setHits(d.hits ?? []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">🧠 RAG 지식 검색</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            자비스 컨시어지가 검색하는 jarvis_hybrid_search RPC 직접 호출 — 사장님이 자비스가 뭘 알고 있는지 검증
          </p>
        </div>
        <Link href="/admin/jarvis" className="text-xs text-violet-600 hover:underline">← 자비스</Link>
      </div>

      <form onSubmit={search} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4 flex flex-col md:flex-row gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="고객 질문 그대로 입력 (예: 다낭 5월 가족여행 노쇼핑)"
          className="flex-1 text-sm border border-slate-300 rounded px-3 py-2"
          autoFocus
        />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="text-sm border border-slate-300 rounded px-2 py-2"
        >
          <option value="">전체</option>
          <option value="package">📦 상품</option>
          <option value="blog">📝 블로그</option>
          <option value="attraction">🗺️ 관광지</option>
        </select>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white text-sm font-semibold px-4 py-2 rounded transition"
        >
          {loading ? '검색중...' : '검색'}
        </button>
      </form>

      {/* 빠른 테스트 쿼리 */}
      <div className="flex flex-wrap gap-2">
        <span className="text-[11px] text-slate-500 self-center">빠른 테스트:</span>
        {['다낭 5월 가족여행', '호화호특 5성호텔 직항', '몽골 게르 휴양', '노옵션 가성비 패키지', '발리 풀빌라'].map(q => (
          <button
            key={q}
            onClick={() => { setQuery(q); setTimeout(search, 50); }}
            className="text-[11px] bg-slate-100 hover:bg-violet-100 text-slate-700 px-2.5 py-1 rounded-full transition"
          >
            {q}
          </button>
        ))}
      </div>

      {/* 결과 */}
      {hits.length > 0 ? (
        <section className="space-y-2">
          <p className="text-xs text-slate-500">{hits.length}건 hit · RRF 점수 순</p>
          {hits.map((h, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-4">
              <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                <span className="text-[11px] font-bold bg-slate-100 px-2 py-0.5 rounded">{i + 1}</span>
                <span className="text-[11px] font-semibold text-slate-600">
                  {SOURCE_LABELS[h.source_type] ?? h.source_type}
                </span>
                <h3 className="text-sm font-bold text-slate-900 flex-1 min-w-0 truncate">
                  {h.source_title}
                </h3>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  RRF {h.rrf_score?.toFixed(3)} · vec {h.vector_score?.toFixed(2)} · bm25 {h.bm25_score?.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed line-clamp-3 break-keep">
                {h.chunk_text}
              </p>
              {h.source_url && (
                <Link href={h.source_url} className="inline-block mt-2 text-[11px] text-violet-600 hover:underline">
                  → 원본 보기
                </Link>
              )}
            </div>
          ))}
        </section>
      ) : query && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <p className="text-sm font-semibold text-amber-800">검색 결과 없음</p>
          <p className="text-xs text-amber-700 mt-1">
            자비스가 이 키워드를 학습하지 않았어요. 관련 상품/블로그 등록 또는 인덱싱 필요.
          </p>
        </div>
      )}
    </div>
  );
}
