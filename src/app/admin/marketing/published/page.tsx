'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtDateTime } from '@/lib/admin-utils';

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
  error_message?: string | null;
  retry_count?: number | null;
  max_retries?: number | null;
  engagement?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram_caption: 'IG Caption',
  instagram_carousel: 'IG Carousel',
  threads_post: 'Threads',
  threads_carousel: 'Threads Carousel',
  meta_ads: 'Meta Ads',
  kakao_channel: 'Kakao Channel',
  google_ads_rsa: 'Google Ads',
  blog_body: 'Blog',
};

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-blue-100 text-blue-700',
  queued: 'bg-blue-100 text-blue-700',
  publishing: 'bg-amber-100 text-amber-700',
  approved: 'bg-cyan-100 text-cyan-700',
  draft: 'bg-neutral-100 text-neutral-600',
  failed: 'bg-red-100 text-red-700',
  archived: 'bg-neutral-100 text-neutral-500',
};

const STATUS_LABEL: Record<string, string> = {
  published: '발행됨',
  scheduled: '예약됨',
  queued: '대기',
  publishing: '발행중',
  approved: '승인됨',
  draft: '초안',
  failed: '실패',
  archived: '종료',
};

const STATUS_OPTIONS = ['published', 'scheduled', 'queued', 'publishing', 'approved', 'draft', 'failed'];

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

  useEffect(() => {
    void load();
  }, [load]);

  const platformStats = useMemo(() => {
    return Object.entries(counts).reduce<Record<string, { published: number; failed: number; other: number }>>((acc, [key, n]) => {
      const [p, s] = key.split(':');
      if (!acc[p]) acc[p] = { published: 0, failed: 0, other: 0 };
      if (s === 'published') acc[p].published += n;
      else if (s === 'failed') acc[p].failed += n;
      else acc[p].other += n;
      return acc;
    }, {});
  }, [counts]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">자동 발행 모니터링</h1>
          <p className="mt-1 text-sm text-neutral-600">
            최근 {days}일의 자동 콘텐츠 발행, 예약, 실패, 재시도 상태를 확인합니다.
          </p>
        </div>
        <a href="/admin/marketing/auto-publish" className="rounded bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700">
          새 자동 발행
        </a>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {Object.entries(platformStats).map(([p, s]) => {
          const total = s.published + s.failed + s.other;
          const successRate = total > 0 ? Math.round((s.published / total) * 100) : 0;
          return (
            <div key={p} className="rounded-lg border border-neutral-200 bg-white p-3">
              <div className="text-xs font-semibold">{PLATFORM_LABEL[p] ?? p}</div>
              <div className="mt-1 text-lg font-bold text-emerald-700">{s.published}</div>
              <div className="text-[10px] text-neutral-500">성공률 {successRate}% · 실패 {s.failed}</div>
            </div>
          );
        })}
      </section>

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
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>{STATUS_LABEL[value] ?? value}</option>
            ))}
          </select>
        </label>
        <button onClick={load} className="rounded bg-neutral-100 px-3 py-1 text-sm hover:bg-neutral-200">
          새로고침
        </button>
        {loading && <span className="text-xs text-neutral-400">로딩 중...</span>}
      </section>

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-3 py-2 text-left">플랫폼</th>
              <th className="px-3 py-2 text-left">상품 / 제목</th>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">발행/예약</th>
              <th className="px-3 py-2 text-left">상태 상세</th>
              <th className="px-3 py-2 text-left">링크</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-neutral-400">결과 없음</td>
              </tr>
            )}
            {items.map((it) => {
              const when = it.published_at ?? it.scheduled_for ?? it.created_at;
              const predictedEr = typeof it.engagement?.predicted_er === 'number'
                ? Number(it.engagement.predicted_er)
                : typeof it.meta?.predicted_er === 'number'
                  ? Number(it.meta.predicted_er)
                  : null;
              const whyThisWillWork = typeof it.meta?.why_this_will_work === 'string' ? it.meta.why_this_will_work : null;
              const learningMode = typeof it.engagement?.learning_mode === 'string'
                ? it.engagement.learning_mode
                : typeof it.meta?.learning_mode === 'string'
                  ? it.meta.learning_mode
                  : null;
              const trendConfidence = typeof it.engagement?.trend_confidence === 'number'
                ? Number(it.engagement.trend_confidence)
                : typeof it.meta?.trend_confidence === 'number'
                  ? Number(it.meta.trend_confidence)
                  : null;
              const insightsStatus = typeof it.engagement?.insights_status === 'string' ? it.engagement.insights_status : null;
              const insightsError = typeof it.engagement?.insights_error === 'string' ? it.engagement.insights_error : null;
              const riskFlags = Array.isArray(it.meta?.risk_flags)
                ? it.meta.risk_flags.filter((v): v is string => typeof v === 'string')
                : [];
              return (
                <tr key={it.id} className="border-t border-neutral-100">
                  <td className="whitespace-nowrap px-3 py-2">{PLATFORM_LABEL[it.platform] ?? it.platform}</td>
                  <td className="px-3 py-2">
                    <div className="line-clamp-1 font-medium">{it.product_title ?? '-'}</div>
                    {it.title && <div className="line-clamp-1 text-xs text-neutral-500">{it.title}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[it.status] ?? 'bg-neutral-100'}`}>
                      {STATUS_LABEL[it.status] ?? it.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-600">
                    {when ? fmtDateTime(when) : '-'}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">
                    {typeof it.retry_count === 'number' && it.retry_count > 0 && (
                      <div>retry {it.retry_count}/{it.max_retries ?? 3}</div>
                    )}
                    {predictedEr !== null && <div>예측 ER {(predictedEr * 100).toFixed(2)}%</div>}
                    {whyThisWillWork && (
                      <div className="max-w-[320px] truncate" title={whyThisWillWork}>
                        {whyThisWillWork}
                      </div>
                    )}
                    {learningMode && (
                      <div>
                        learning: {learningMode}{trendConfidence !== null ? ` (${Math.round(trendConfidence * 100)}%)` : ''}
                      </div>
                    )}
                    {insightsStatus && <div>insights: {insightsStatus}</div>}
                    {insightsError && (
                      <div className="max-w-[320px] truncate text-red-600" title={insightsError}>
                        insights error: {insightsError}
                      </div>
                    )}
                    {riskFlags.length > 0 && (
                      <div className="max-w-[320px] truncate text-amber-700" title={riskFlags.join(', ')}>
                        risk: {riskFlags.join(', ')}
                      </div>
                    )}
                    {it.error_message && (
                      <div className="max-w-[320px] truncate text-red-600" title={it.error_message}>
                        {it.error_message}
                      </div>
                    )}
                    {!it.error_message && !it.retry_count && predictedEr === null && !whyThisWillWork && !learningMode && !insightsStatus && !insightsError && riskFlags.length === 0 && (
                      <span className="text-neutral-300">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {it.external_url ? (
                      <a href={it.external_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                        열기
                      </a>
                    ) : (
                      <span className="text-neutral-300">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="mt-4 text-xs text-neutral-400">
        데이터 소스: content_distributions, card_news, content_creatives. 새로고침은 수동이며 실시간성 확인을 우선합니다.
      </p>
    </main>
  );
}
