'use client';

/**
 * /admin/marketing/published — 자동 발행 결과 모니터링
 *
 * 최근 14일치 모든 자동 발행물을 한 화면에서 확인:
 *   - content_distributions (IG/Threads/MetaAds/Kakao/GoogleAds)
 *   - card_news 직접 큐 (캐러셀)
 *   - content_creatives (블로그)
 *
 * 필터: 플랫폼 / 상태 / 일수
 * 액션: 외부 URL 새 탭 열기, 카피 미리보기
 */
import { useState, useEffect, useCallback } from 'react';

interface FeedItem {
  source: 'distribution' | 'card_news' | 'blog';
  id: string;
  platform: string;
  status: string;
  title: string | null;
  product_id: string | null;
  product_title: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  external_url: string | null;
  external_id: string | null;
  created_at: string;
  tenant_id: string | null;
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram_caption: '📷 IG 캡션',
  instagram_carousel: '📷 IG 캐러셀',
  threads_post: '🧵 Threads',
  threads_carousel: '🧵 Threads 캐러셀',
  meta_ads: '🎯 Meta Ads',
  kakao_channel: '💬 카카오',
  google_ads_rsa: '🔍 Google Ads',
  blog_body: '📝 블로그',
};

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-blue-100 text-blue-700',
  queued: 'bg-blue-100 text-blue-700',
  publishing: 'bg-amber-100 text-amber-700',
  draft: 'bg-neutral-100 text-neutral-600',
  failed: 'bg-red-100 text-red-700',
  archived: 'bg-neutral-100 text-neutral-500',
};

const STATUS_LABEL: Record<string, string> = {
  published: '발행됨',
  scheduled: '예약',
  queued: '큐 대기',
  publishing: '발행중',
  draft: '초안',
  failed: '실패',
  archived: '종료',
};

export default function PublishedFeedPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(14);
  const [platform, setPlatform] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days), limit: '100' });
      if (platform) params.set('platform', platform);
      if (status) params.set('status', status);
      const res = await fetch(`/api/admin/published-feed?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
        setCounts(data.counts ?? {});
      }
    } finally {
      setLoading(false);
    }
  }, [days, platform, status]);

  useEffect(() => { void load(); }, [load]);

  // 상단 통계: 플랫폼별 published vs failed
  const platformStats = Object.entries(counts).reduce<Record<string, { published: number; failed: number; other: number }>>((acc, [key, n]) => {
    const [p, s] = key.split(':');
    if (!acc[p]) acc[p] = { published: 0, failed: 0, other: 0 };
    if (s === 'published') acc[p].published += n;
    else if (s === 'failed') acc[p].failed += n;
    else acc[p].other += n;
    return acc;
  }, {});

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">📊 자동 발행 모니터링</h1>
          <p className="mt-1 text-sm text-neutral-600">최근 {days}일 자동 콘텐츠 파이프라인 발행 결과 통합 피드.</p>
        </div>
        <a href="/admin/marketing/auto-publish" className="rounded bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700">
          🚀 새 자동 발행
        </a>
      </header>

      {/* 통계 */}
      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {Object.entries(platformStats).map(([p, s]) => {
          const total = s.published + s.failed + s.other;
          const successRate = total > 0 ? Math.round((s.published / total) * 100) : 0;
          return (
            <div key={p} className="rounded-lg border border-neutral-200 bg-white p-3">
              <div className="text-xs font-semibold">{PLATFORM_LABEL[p] ?? p}</div>
              <div className="mt-1 text-lg font-bold text-emerald-700">{s.published}</div>
              <div className="text-[10px] text-neutral-500">
                성공률 {successRate}% · 실패 {s.failed}
              </div>
            </div>
          );
        })}
      </section>

      {/* 필터 */}
      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <label className="block">
          <span className="block text-xs text-neutral-600">기간</span>
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} className="mt-0.5 rounded border border-neutral-300 px-2 py-1 text-sm">
            <option value="7">7일</option>
            <option value="14">14일</option>
            <option value="30">30일</option>
            <option value="60">60일</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-neutral-600">플랫폼</span>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="mt-0.5 rounded border border-neutral-300 px-2 py-1 text-sm">
            <option value="">전체</option>
            {Object.entries(PLATFORM_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-neutral-600">상태</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-0.5 rounded border border-neutral-300 px-2 py-1 text-sm">
            <option value="">전체</option>
            <option value="published">발행됨</option>
            <option value="scheduled">예약</option>
            <option value="queued">큐 대기</option>
            <option value="failed">실패</option>
          </select>
        </label>
        <button onClick={load} className="rounded bg-neutral-100 px-3 py-1 text-sm hover:bg-neutral-200">
          새로고침
        </button>
        {loading && <span className="text-xs text-neutral-400">로딩 중...</span>}
      </section>

      {/* 피드 테이블 */}
      <section className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-3 py-2 text-left">플랫폼</th>
              <th className="px-3 py-2 text-left">상품 / 제목</th>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">발행/예약</th>
              <th className="px-3 py-2 text-left">링크</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-neutral-400">결과 없음</td></tr>
            )}
            {items.map((it) => {
              const when = it.published_at ?? it.scheduled_for ?? it.created_at;
              return (
                <tr key={it.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2 whitespace-nowrap">{PLATFORM_LABEL[it.platform] ?? it.platform}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium line-clamp-1">{it.product_title ?? '—'}</div>
                    {it.title && <div className="text-xs text-neutral-500 line-clamp-1">{it.title}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[it.status] ?? 'bg-neutral-100'}`}>
                      {STATUS_LABEL[it.status] ?? it.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-600">
                    {when ? new Date(when).toLocaleString('ko-KR') : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {it.external_url ? (
                      <a href={it.external_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        열기 ↗
                      </a>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="mt-4 text-xs text-neutral-400">
        · 데이터: content_distributions + card_news + content_creatives 통합
        · 새로고침은 수동. ISR 미사용 (실시간성 우선).
      </p>
    </main>
  );
}
