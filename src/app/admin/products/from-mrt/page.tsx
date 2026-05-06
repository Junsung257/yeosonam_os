'use client';

import { useState, useCallback, useEffect } from 'react';
import type { StayResult, ActivityResult } from '@/lib/travel-providers/types';

interface TnaCategory {
  id:     string;
  name:   string;
  count?: number;
}

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface SearchResult {
  type:    'stay' | 'tna';
  item:    StayResult | ActivityResult;
  csOk:   boolean;
  csNote: string;
}

// ─── CS 필터 (프론트 미리보기용 — 실제 강제는 API) ────────────────────────────

function checkCs(item: StayResult | ActivityResult, type: 'stay' | 'tna'): { ok: boolean; note: string } {
  const rating = type === 'stay'
    ? (item as StayResult).rating
    : (item as ActivityResult).rating;
  const count  = (item as StayResult).reviewCount ?? (item as ActivityResult).reviewCount;
  if (rating !== undefined && rating < 4.5)  return { ok: false, note: `평점 ${rating} < 4.5` };
  if (count  !== undefined && count  < 100)  return { ok: false, note: `리뷰 ${count}건 < 100` };
  return { ok: true, note: '✓ CS 필터 통과' };
}

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────

export default function FromMrtPage() {
  const [query, setQuery]         = useState('');
  const [type, setType]           = useState<'stay' | 'tna'>('stay');
  const [destination, setDestination] = useState('');
  const [nights, setNights]       = useState(3);
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const [success, setSuccess]     = useState<Record<string, string>>({});

  // 카테고리 필터 (tna 전용)
  const [categories, setCategories]       = useState<TnaCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  useEffect(() => {
    if (type !== 'tna' || !query.trim()) { setCategories([]); setSelectedCategory(''); return; }
    const city = destination.trim() || query.trim();
    fetch(`/api/travel/tna-categories?city=${encodeURIComponent(city)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((json: { categories?: TnaCategory[] }) => setCategories(json.categories ?? []))
      .catch(() => setCategories([]));
  }, [type, query, destination]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const catParam = type === 'tna' && selectedCategory ? `&category=${encodeURIComponent(selectedCategory)}` : '';
      const ep = type === 'stay'
        ? `/api/travel/search-stays?keyword=${encodeURIComponent(query)}&checkIn=${new Date().toISOString().slice(0, 10)}&checkOut=${new Date(Date.now() + nights * 86400_000).toISOString().slice(0, 10)}&adults=2`
        : `/api/travel/search-activities?destination=${encodeURIComponent(query)}&limit=20${catParam}`;

      const res = await fetch(ep);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { results?: (StayResult | ActivityResult)[] };
      const items = json.results ?? [];

      setResults(items.map(item => {
        const cs = checkCs(item, type);
        return { type, item, csOk: cs.ok, csNote: cs.note };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '검색 실패');
    } finally {
      setLoading(false); }
  }, [query, type, nights, selectedCategory]);

  const handleRegister = useCallback(async (r: SearchResult) => {
    const key = (r.item as StayResult).providerId ?? (r.item as ActivityResult).providerId;
    setRegistering(key);
    try {
      const res = await fetch('/api/products/from-mrt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:        r.type,
          item:        r.item,
          destination: destination || query,
          nights,
        }),
      });
      const json = await res.json() as { ok?: boolean; product?: { internal_code: string }; error?: string; existing_code?: string };
      if (!res.ok) throw new Error(json.error ?? '등록 실패');
      setSuccess(prev => ({ ...prev, [key]: json.product?.internal_code ?? '등록 완료' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '등록 실패');
    } finally {
      setRegistering(null);
    }
  }, [destination, query, nights]);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">MRT에서 상품 가져오기</h1>
      <p className="text-sm text-slate-500 mb-6">마이리얼트립 검색 결과에서 호텔·투어를 직접 상품으로 등록합니다.<br />CS 필터: 평점 4.5↑ + 리뷰 100건↑ 강제</p>

      {/* 검색 폼 */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5 mb-6 space-y-3 shadow-sm">
        <div className="flex gap-2">
          <button onClick={() => setType('stay')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${type === 'stay' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
            호텔·숙박
          </button>
          <button onClick={() => setType('tna')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${type === 'tna' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>
            투어·액티비티
          </button>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            placeholder={type === 'stay' ? '도시명 (예: 다낭, 방콕)' : '검색어 (예: 다낭 쿠킹클래스)'}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          {type === 'stay' && (
            <input
              type="number"
              min={1} max={14}
              value={nights}
              onChange={e => setNights(parseInt(e.target.value, 10))}
              className="w-20 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
              title="박 수"
            />
          )}
          <input
            value={destination}
            onChange={e => setDestination(e.target.value)}
            placeholder="목적지 한국어 (예: 다낭)"
            className="w-36 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-blue-700"
          >
            {loading ? '검색 중...' : '검색'}
          </button>
        </div>
        {/* 카테고리 필터 (tna 전용) */}
        {type === 'tna' && categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              onClick={() => setSelectedCategory('')}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedCategory === ''
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              전체
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id === selectedCategory ? '' : cat.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {cat.name}{cat.count ? ` (${cat.count})` : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">{error}</div>
      )}

      {/* 결과 목록 */}
      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">{results.length}건 검색됨 (CS 통과: {results.filter(r => r.csOk).length}건)</p>
          {results.map((r, i) => {
            const item = r.item;
            const key  = (item as StayResult).providerId ?? (item as ActivityResult).providerId;
            const name = type === 'stay'
              ? (item as StayResult).name
              : (item as ActivityResult).name;
            const rating = type === 'stay'
              ? (item as StayResult).rating
              : (item as ActivityResult).rating;
            const reviewCount = (item as StayResult).reviewCount ?? (item as ActivityResult).reviewCount;
            const price = type === 'stay'
              ? `${(item as StayResult).pricePerNight?.toLocaleString()}원/박`
              : `${(item as ActivityResult).price?.toLocaleString()}원~`;
            const thumbUrl = type === 'stay'
              ? (item as StayResult).imageUrl
              : (item as ActivityResult).imageUrl;

            return (
              <div key={i} className={`bg-white border rounded-xl p-4 shadow-sm flex gap-4 ${r.csOk ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}>
                {thumbUrl && (
                  <img src={thumbUrl} alt={name} className="w-20 h-20 object-cover rounded-lg shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-admin-base font-semibold text-slate-900 leading-tight">{name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        {rating != null && (
                          <span className="text-admin-xs text-amber-600 font-medium">★ {rating.toFixed(1)}</span>
                        )}
                        {reviewCount != null && (
                          <span className="text-[11px] text-slate-500">리뷰 {reviewCount.toLocaleString()}건</span>
                        )}
                        <span className="text-admin-xs text-blue-600 font-semibold">{price}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full mb-2 ${r.csOk ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-500'}`}>
                        {r.csNote}
                      </span>
                      {success[key] ? (
                        <p className="text-[11px] text-green-600 font-semibold">{success[key]}</p>
                      ) : r.csOk && (
                        <button
                          onClick={() => handleRegister(r)}
                          disabled={registering === key}
                          className="block text-admin-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold"
                        >
                          {registering === key ? '등록 중...' : '상품 등록'}
                        </button>
                      )}
                    </div>
                  </div>
                  {type === 'stay' && (item as StayResult).location && (
                    <p className="text-[11px] text-slate-500 mt-1">{(item as StayResult).location}</p>
                  )}
                  {type === 'tna' && (item as ActivityResult).duration && (
                    <p className="text-[11px] text-slate-500 mt-1">소요: {(item as ActivityResult).duration}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {results.length === 0 && !loading && !error && (
        <div className="text-center py-12 text-slate-400 text-sm">검색어를 입력하고 검색 버튼을 누르세요.</div>
      )}
    </div>
  );
}
