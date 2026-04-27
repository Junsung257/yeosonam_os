'use client';

/**
 * /admin/marketing/auto-publish — One-stop 자동 발행 패널
 *
 * 사용법: 상품 ID 또는 검색 → "🚀 자동 발행 시작" 클릭 → 끝
 *
 * 백엔드: POST /api/orchestrator/auto-publish
 *   - 5종 에이전트 병렬 (IG/Threads/Meta Ads/Kakao/Google Ads)
 *   - 카드뉴스 5변형 백그라운드 트리거
 *   - 블로그 토픽 큐 등록 (다음 매시간 cron 처리)
 *   - 모든 발행 시각은 best_publish_slots view 기반 자동 결정
 */
import { useState, useCallback } from 'react';

interface DistRow {
  id: string;
  platform: string;
  scheduled_for: string | null;
  slot_source: string;
}

interface AutoPublishResult {
  ok: boolean;
  product_id: string;
  product_title: string;
  tenant_id: string | null;
  elapsed_ms: number;
  distributions: DistRow[];
  blog_queue_id: string | null;
  blog_scheduled_for: string | null;
  card_news_variants: { triggered: boolean; reason?: string };
  agent_failures: Array<{ platform: string; error: string }>;
  brief_h1: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram_caption: 'Instagram',
  threads_post: 'Threads',
  meta_ads: 'Meta Ads',
  kakao_channel: '카카오 채널',
  google_ads_rsa: 'Google Ads',
  blog_body: '블로그',
};

export default function AutoPublishPage() {
  const [productId, setProductId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AutoPublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!productId.trim()) {
      setError('상품 ID 필요');
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/orchestrator/auto-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId.trim(),
          tenant_id: tenantId.trim() || undefined,
          dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '오류');
      } else {
        setResult(data as AutoPublishResult);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [productId, tenantId, dryRun]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">🚀 원스톱 자동 발행</h1>
        <p className="mt-1 text-sm text-neutral-600">
          상품 ID 하나 → 5개 플랫폼 (Instagram · Threads · Meta Ads · 카카오 · Google Ads) 자동 카피 생성 + Best Time 슬롯에 예약 발행 + 카드뉴스 5변형 + 블로그 큐잉.
          외부 SaaS 0원, Gemini + Supabase + 자체 cron만 사용.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <label className="block">
          <span className="text-sm font-medium text-neutral-700">상품 ID (UUID)</span>
          <input
            type="text"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-medium text-neutral-700">테넌트 ID (선택, 비우면 본사)</span>
          <input
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="(선택)"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 font-mono text-sm"
          />
        </label>
        <label className="mt-3 inline-flex items-center gap-2">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          <span className="text-sm">Dry-run (생성만, 발행 큐잉 안 함)</span>
        </label>

        <button
          onClick={submit}
          disabled={loading || !productId.trim()}
          className="mt-5 w-full rounded bg-orange-600 py-3 text-base font-semibold text-white hover:bg-orange-700 disabled:bg-neutral-300"
        >
          {loading ? '생성 중... (30~90초)' : '🚀 자동 발행 시작'}
        </button>

        {error && (
          <div className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
      </section>

      {result && (
        <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-lg font-semibold">완료 ({(result.elapsed_ms / 1000).toFixed(1)}s)</h2>
          <p className="mt-1 text-sm text-neutral-600">{result.product_title}</p>
          <p className="mt-1 text-xs text-neutral-500">brief: {result.brief_h1}</p>

          <h3 className="mt-4 mb-2 text-sm font-semibold">예약 발행 큐</h3>
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-2 py-1 text-left">플랫폼</th>
                <th className="px-2 py-1 text-left">발행 시각</th>
                <th className="px-2 py-1 text-left">시각 결정</th>
              </tr>
            </thead>
            <tbody>
              {result.distributions.map((d) => (
                <tr key={d.id} className="border-t border-neutral-100">
                  <td className="px-2 py-1">{PLATFORM_LABEL[d.platform] ?? d.platform}</td>
                  <td className="px-2 py-1 font-mono text-xs">
                    {d.scheduled_for ? new Date(d.scheduled_for).toLocaleString('ko-KR') : '—'}
                  </td>
                  <td className="px-2 py-1 text-xs">
                    {d.slot_source === 'data_driven' ? '📊 engagement 기반' : '⏰ 평일 19시 폴백'}
                  </td>
                </tr>
              ))}
              {result.blog_queue_id && (
                <tr className="border-t border-neutral-100 bg-blue-50">
                  <td className="px-2 py-1">블로그</td>
                  <td className="px-2 py-1 font-mono text-xs">
                    {result.blog_scheduled_for ? new Date(result.blog_scheduled_for).toLocaleString('ko-KR') : '—'}
                  </td>
                  <td className="px-2 py-1 text-xs">
                    매시간 blog-publisher cron 처리
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {result.card_news_variants.triggered && (
            <p className="mt-3 text-xs text-neutral-600">✓ 카드뉴스 5변형 백그라운드 생성 시작 (1~3분 소요)</p>
          )}

          {result.agent_failures.length > 0 && (
            <div className="mt-3 rounded bg-amber-50 p-3 text-xs">
              <strong>일부 실패:</strong>
              <ul className="mt-1 ml-4 list-disc">
                {result.agent_failures.map((f, i) => (
                  <li key={i}>{f.platform}: {f.error}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
