/**
 * /admin/jarvis/rag — 자비스가 학습한 RAG 지식 직접 검색 (v6, 2026-04-30)
 *
 * 사장님이 "자비스가 X를 알고 있나?" 검증할 수 있는 운영 도구.
 * 실제 jarvis_hybrid_search RPC 를 그대로 호출해서 결과 노출.
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { ArrowLeft, Search } from 'lucide-react';

interface Hit {
  source_type: string;
  source_id: string;
  source_title: string;
  source_url: string | null;
  chunk_text: string;
  contextual_text: string;
  confidence: number;
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
    <div className="max-w-5xl mx-auto space-y-5">
      <PageHeader
        title="RAG 지식 검색"
        subtitle="자비스 컨시어지가 검색하는 jarvis_hybrid_search RPC 직접 호출 — 사장님이 자비스가 뭘 알고 있는지 검증"
        actions={
          <Link href="/admin/jarvis">
            <Button variant="secondary" size="sm">
              <ArrowLeft size={14} />
              자비스
            </Button>
          </Link>
        }
      />

      <form onSubmit={search} className="admin-card p-4 flex flex-col md:flex-row gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="고객 질문 그대로 입력 (예: 다낭 5월 가족여행 노쇼핑)"
          className="flex-1 h-9 text-admin-base border border-admin-border-mid rounded-admin-sm px-3 bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          autoFocus
        />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="h-9 text-admin-sm border border-admin-border-mid rounded-admin-sm px-2.5 bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
        >
          <option value="">전체</option>
          <option value="package">📦 상품</option>
          <option value="blog">📝 블로그</option>
          <option value="attraction">🗺️ 관광지</option>
        </select>
        <Button type="submit" variant="primary" disabled={loading || !query.trim()}>
          <Search size={14} />
          {loading ? '검색 중…' : '검색'}
        </Button>
      </form>

      {/* 빠른 테스트 쿼리 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-admin-xs text-admin-muted self-center">빠른 테스트:</span>
        {['다낭 5월 가족여행', '호화호특 5성호텔 직항', '몽골 게르 휴양', '노옵션 가성비 패키지', '발리 풀빌라'].map(q => (
          <button
            key={q}
            onClick={() => { setQuery(q); setTimeout(search, 50); }}
            className="text-admin-xs bg-admin-surface border border-admin-border-mid hover:bg-brand-light hover:border-brand text-admin-text-2 px-2.5 py-1 rounded-full transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      {/* 결과 */}
      {hits.length > 0 ? (
        <section className="space-y-2">
          <p className="text-admin-xs text-admin-muted"><span className="admin-num">{hits.length}</span>건 hit · RRF 점수 순</p>
          {hits.map((h, i) => (
            <div key={i} className="admin-card p-4">
              <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                <span className="text-admin-xs font-semibold bg-admin-surface-2 text-admin-text-2 px-2 py-0.5 rounded-admin-xs admin-num">{i + 1}</span>
                <span className="text-admin-xs font-semibold text-admin-muted">
                  {SOURCE_LABELS[h.source_type] ?? h.source_type}
                </span>
                <h3 className="text-admin-sm font-semibold text-admin-text flex-1 min-w-0 truncate">
                  {h.source_title}
                </h3>
                <span className="text-admin-2xs text-admin-muted-2 admin-num font-mono">
                  confidence {Math.round((h.confidence ?? 0) * 100)}% · RRF {h.rrf_score?.toFixed(3)} · vec {h.vector_score?.toFixed(2)} · bm25 {h.bm25_score?.toFixed(2)}
                </span>
              </div>
              <p className="text-admin-xs text-admin-text-2 leading-relaxed line-clamp-3 break-keep">
                {h.chunk_text}
              </p>
              {h.source_url && (
                <Link href={h.source_url} className="inline-block mt-2 text-admin-xs text-brand hover:text-brand-dark hover:underline font-medium">
                  → 원본 보기
                </Link>
              )}
            </div>
          ))}
        </section>
      ) : query && !loading && (
        <div className="bg-status-warningBg border border-warning/20 rounded-admin-md p-6 text-center">
          <p className="text-admin-base font-semibold text-status-warningFg">검색 결과 없음</p>
          <p className="text-admin-xs text-status-warningFg mt-1 opacity-80">
            자비스가 이 키워드를 학습하지 않았어요. 관련 상품/블로그 등록 또는 인덱싱 필요.
          </p>
        </div>
      )}
    </div>
  );
}
