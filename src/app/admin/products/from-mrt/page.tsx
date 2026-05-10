'use client';

import { useState, useCallback, useEffect } from 'react';
import type { StayResult, ActivityResult } from '@/lib/travel-providers/types';
import { PageHeader } from '@/components/admin/patterns';
import Button from '@/components/ui/Button';
import { Search, Hotel, Compass } from 'lucide-react';

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
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="MRT 에서 상품 가져오기"
        subtitle={
          <>마이리얼트립 검색 결과에서 호텔·투어를 직접 상품으로 등록합니다. CS 필터: 평점 <b className="text-admin-text">4.5↑</b> + 리뷰 <b className="text-admin-text">100건↑</b> 강제</>
        }
      />

      {/* 검색 폼 */}
      <div className="admin-card p-5 mb-5 space-y-3">
        <div className="flex gap-1.5">
          <button
            onClick={() => setType('stay')}
            className={`h-9 px-3.5 inline-flex items-center gap-1.5 rounded-admin-sm text-admin-sm font-medium transition-colors ${
              type === 'stay'
                ? 'bg-brand text-white'
                : 'bg-admin-surface text-admin-text-2 border border-admin-border-mid hover:bg-admin-surface-2 hover:border-admin-border-strong'
            }`}
          >
            <Hotel size={14} />
            호텔·숙박
          </button>
          <button
            onClick={() => setType('tna')}
            className={`h-9 px-3.5 inline-flex items-center gap-1.5 rounded-admin-sm text-admin-sm font-medium transition-colors ${
              type === 'tna'
                ? 'bg-brand text-white'
                : 'bg-admin-surface text-admin-text-2 border border-admin-border-mid hover:bg-admin-surface-2 hover:border-admin-border-strong'
            }`}
          >
            <Compass size={14} />
            투어·액티비티
          </button>
        </div>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
            placeholder={type === 'stay' ? '도시명 (예: 다낭, 방콕)' : '검색어 (예: 다낭 쿠킹클래스)'}
            className="flex-1 h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
          {type === 'stay' && (
            <input
              type="number"
              min={1} max={14}
              value={nights}
              onChange={e => setNights(parseInt(e.target.value, 10))}
              className="w-20 h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text admin-num focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
              title="박 수"
            />
          )}
          <input
            value={destination}
            onChange={e => setDestination(e.target.value)}
            placeholder="목적지 한국어 (예: 다낭)"
            className="w-36 h-9 border border-admin-border-mid rounded-admin-sm px-3 text-admin-base bg-admin-surface text-admin-text focus:outline-none focus:shadow-admin-focus focus:border-brand transition-colors"
          />
          <Button variant="primary" onClick={handleSearch} disabled={loading || !query.trim()}>
            <Search size={14} />
            {loading ? '검색 중…' : '검색'}
          </Button>
        </div>
        {/* 카테고리 필터 (tna 전용) */}
        {type === 'tna' && categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              onClick={() => setSelectedCategory('')}
              className={`h-7 px-3 rounded-full text-admin-xs font-medium border transition-colors ${
                selectedCategory === ''
                  ? 'bg-brand text-white border-brand'
                  : 'bg-admin-surface text-admin-muted border-admin-border-mid hover:bg-admin-surface-2'
              }`}
            >
              전체
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id === selectedCategory ? '' : cat.id)}
                className={`h-7 px-3 rounded-full text-admin-xs font-medium border transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-brand text-white border-brand'
                    : 'bg-admin-surface text-admin-muted border-admin-border-mid hover:bg-admin-surface-2'
                }`}
              >
                {cat.name}{cat.count ? <span className="admin-num"> ({cat.count})</span> : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-danger-light border border-danger/20 rounded-admin-sm px-4 py-3 text-admin-sm text-danger mb-4">{error}</div>
      )}

      {/* 결과 목록 */}
      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-admin-sm text-admin-muted">
            <span className="admin-num">{results.length}</span>건 검색됨 (CS 통과: <b className="text-success admin-num">{results.filter(r => r.csOk).length}</b>건)
          </p>
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
              <div key={i} className={`bg-admin-surface border rounded-admin-md p-4 shadow-admin-xs flex gap-4 ${r.csOk ? 'border-admin-border-mid' : 'border-admin-border opacity-60'}`}>
                {thumbUrl && (
                  <img src={thumbUrl} alt={name} className="w-20 h-20 object-cover rounded-admin-sm shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-admin-base font-semibold text-admin-text leading-tight">{name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        {rating != null && (
                          <span className="text-admin-xs text-warning font-semibold admin-num">★ {rating.toFixed(1)}</span>
                        )}
                        {reviewCount != null && (
                          <span className="text-admin-xs text-admin-muted admin-num">리뷰 {reviewCount.toLocaleString()}건</span>
                        )}
                        <span className="text-admin-xs text-brand font-semibold admin-num">{price}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={`inline-block text-admin-2xs font-semibold px-2 py-0.5 rounded-admin-xs mb-2 ${r.csOk ? 'bg-status-successBg text-status-successFg' : 'bg-status-dangerBg text-status-dangerFg'}`}>
                        {r.csNote}
                      </span>
                      {success[key] ? (
                        <p className="text-admin-xs text-success font-semibold">{success[key]}</p>
                      ) : r.csOk && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleRegister(r)}
                          disabled={registering === key}
                        >
                          {registering === key ? '등록 중…' : '상품 등록'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {type === 'stay' && (item as StayResult).location && (
                    <p className="text-admin-xs text-admin-muted mt-1">{(item as StayResult).location}</p>
                  )}
                  {type === 'tna' && (item as ActivityResult).duration && (
                    <p className="text-admin-xs text-admin-muted mt-1">소요: {(item as ActivityResult).duration}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {results.length === 0 && !loading && !error && (
        <div className="text-center py-12 text-admin-muted text-admin-sm admin-card">검색어를 입력하고 검색 버튼을 누르세요.</div>
      )}
    </div>
  );
}
