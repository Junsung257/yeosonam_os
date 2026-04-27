'use client';

/**
 * /admin/marketing/auto-publish — One-stop 자동 발행 패널
 *
 * 사용법: 상품 검색 → 선택 → 옵션 → "🚀 자동 발행 시작" → 결과 카피 검토
 *
 * 백엔드: POST /api/orchestrator/auto-publish
 *   - 5종 에이전트 병렬 (IG/Threads/Meta Ads/Kakao/Google Ads)
 *   - 카드뉴스 5변형 백그라운드 트리거
 *   - 블로그 토픽 큐 등록
 *   - 발행 시각: Best Time RPC 또는 즉시
 */
import { Fragment, useState, useCallback, useEffect } from 'react';

interface DistRow {
  id: string;
  platform: string;
  scheduled_for: string | null;
  slot_source: string;
  payload?: Record<string, unknown>;
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
  card_news_variants: { triggered: boolean; payload?: Record<string, unknown> | null; reason?: string };
  agent_failures: Array<{ platform: string; error: string }>;
  brief_h1: string;
  duplicate_warning?: { recent_count: number; last_at: string } | null;
  cost_estimate?: {
    total_usd: number;
    breakdown: {
      content_brief_usd: number;
      agents_usd: number;
      card_news_variants_usd: number;
    };
    note: string;
  };
}

interface ProductSuggestion {
  id: string;
  title: string;
  destination: string | null;
  short_code: string | null;
  status: string | null;
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
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [selected, setSelected] = useState<ProductSuggestion | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [dryRun, setDryRun] = useState(false);
  const [publishNow, setPublishNow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<AutoPublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [cardNewsTriggering, setCardNewsTriggering] = useState(false);
  const [cardNewsResult, setCardNewsResult] = useState<{ ok: boolean; group_id?: string; error?: string } | null>(null);

  // 디바운스된 상품 검색
  useEffect(() => {
    if (selected) return; // 이미 선택했으면 검색 안 함
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/packages?q=${encodeURIComponent(q)}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          const list = (data.packages ?? data.data ?? []) as ProductSuggestion[];
          setSuggestions(list.slice(0, 8));
        }
      } catch { /* noop */ } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, selected]);

  const submit = useCallback(async () => {
    if (!selected) {
      setError('상품을 선택해주세요');
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
          product_id: selected.id,
          tenant_id: tenantId.trim() || undefined,
          dryRun,
          publishNow,
        }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 207) {
        setError(data.error ?? `오류 (${res.status})`);
      } else {
        setResult(data as AutoPublishResult);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selected, tenantId, dryRun, publishNow]);

  const reset = () => {
    setSelected(null);
    setQuery('');
    setSuggestions([]);
    setResult(null);
    setError(null);
    setExpandedRow(null);
    setCardNewsResult(null);
  };

  // 카드뉴스 5변형 — 어드민 클라이언트 fetch (쿠키 자동 첨부).
  const triggerCardNewsVariants = useCallback(async () => {
    if (!result?.card_news_variants?.payload) return;
    setCardNewsTriggering(true);
    setCardNewsResult(null);
    try {
      const res = await fetch('/api/card-news/generate-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.card_news_variants.payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setCardNewsResult({ ok: false, error: data.error ?? `오류 (${res.status})` });
      } else {
        setCardNewsResult({ ok: true, group_id: data.variant_group_id });
      }
    } catch (e) {
      setCardNewsResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setCardNewsTriggering(false);
    }
  }, [result]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">🚀 원스톱 자동 발행</h1>
        <p className="mt-1 text-sm text-neutral-600">
          상품 1개 → 5개 플랫폼 (Instagram · Threads · Meta Ads · 카카오 · Google Ads) 자동 카피 + Best Time 예약 발행 + 카드뉴스 5변형 + 블로그 큐.
          외부 SaaS 0원 · Gemini + Supabase + 자체 cron만 사용.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        {/* 상품 검색 또는 선택된 상품 표시 */}
        {selected ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold truncate">{selected.title}</div>
                <div className="mt-0.5 text-xs text-neutral-600">
                  {selected.destination ?? '—'} · {selected.short_code ?? '코드 없음'}
                  <span className="ml-2 rounded bg-white px-1.5 py-0.5 text-[10px]">{selected.status ?? 'unknown'}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-neutral-400">{selected.id}</div>
              </div>
              <button onClick={reset} className="text-xs text-neutral-500 hover:text-neutral-700">변경</button>
            </div>
          </div>
        ) : (
          <div className="relative">
            <label className="block">
              <span className="text-sm font-medium text-neutral-700">상품 검색</span>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="제목 / 목적지 / 상품코드 (2자 이상)"
                className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>
            {searching && <div className="mt-1 text-xs text-neutral-400">검색 중...</div>}
            {suggestions.length > 0 && (
              <ul className="mt-1 max-h-72 overflow-auto rounded border border-neutral-200 bg-white shadow-sm">
                {suggestions.map((s) => (
                  <li
                    key={s.id}
                    onClick={() => { setSelected(s); setQuery(s.title); setSuggestions([]); }}
                    className="cursor-pointer border-b border-neutral-100 px-3 py-2 text-sm hover:bg-neutral-50 last:border-b-0"
                  >
                    <div className="font-medium truncate">{s.title}</div>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {s.destination ?? '—'} · {s.short_code ?? '—'} · <span className="text-neutral-400">{s.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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

        <div className="mt-3 flex flex-col gap-2">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} disabled={publishNow} />
            <span className="text-sm">Dry-run (생성만, 발행 큐잉 안 함)</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} disabled={dryRun} />
            <span className="text-sm">⚡ 지금 발행 (Best Time 무시, 즉시 큐 적재)</span>
          </label>
        </div>

        <button
          onClick={submit}
          disabled={loading || !selected}
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
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">완료 ({(result.elapsed_ms / 1000).toFixed(1)}s)</h2>
              <p className="mt-1 text-sm text-neutral-600">{result.product_title}</p>
              <p className="mt-1 text-xs text-neutral-500">brief: {result.brief_h1}</p>
            </div>
            {result.cost_estimate && (
              <div className="rounded bg-neutral-50 px-3 py-2 text-right">
                <div className="text-[10px] uppercase tracking-wide text-neutral-500">예상 비용</div>
                <div className="text-base font-bold text-emerald-700">${result.cost_estimate.total_usd}</div>
                <div className="mt-0.5 text-[10px] text-neutral-400">
                  brief ${result.cost_estimate.breakdown.content_brief_usd} ·
                  agents ${result.cost_estimate.breakdown.agents_usd} ·
                  변형 ${result.cost_estimate.breakdown.card_news_variants_usd}
                </div>
              </div>
            )}
          </div>
          <a href="/admin/marketing/published" className="mt-2 inline-block text-xs text-blue-600 hover:underline">
            → 발행 결과 모니터링 보기
          </a>

          {result.duplicate_warning && (
            <div className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-800">
              ⚠️ 최근 5분 내 같은 상품이 {result.duplicate_warning.recent_count}회 트리거됨
              (마지막 {new Date(result.duplicate_warning.last_at).toLocaleString('ko-KR')})
              — 중복 발행에 주의하세요.
            </div>
          )}

          <h3 className="mt-4 mb-2 text-sm font-semibold">예약 발행 큐 ({result.distributions.length}건)</h3>
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="px-2 py-1 text-left">플랫폼</th>
                <th className="px-2 py-1 text-left">발행 시각</th>
                <th className="px-2 py-1 text-left">시각 결정</th>
                <th className="px-2 py-1 text-left">카피</th>
              </tr>
            </thead>
            <tbody>
              {result.distributions.map((d) => (
                <Fragment key={d.id}>
                  <tr className="border-t border-neutral-100">
                    <td className="px-2 py-1">{PLATFORM_LABEL[d.platform] ?? d.platform}</td>
                    <td className="px-2 py-1 font-mono text-xs">
                      {d.scheduled_for ? new Date(d.scheduled_for).toLocaleString('ko-KR') : '—'}
                    </td>
                    <td className="px-2 py-1 text-xs">
                      {d.slot_source === 'data_driven' ? '📊 engagement' : d.slot_source === 'now' ? '⚡ 즉시' : '⏰ 19시 폴백'}
                    </td>
                    <td className="px-2 py-1 text-xs">
                      {d.payload && (
                        <button
                          onClick={() => setExpandedRow(expandedRow === d.id ? null : d.id)}
                          className="text-blue-600 hover:underline"
                        >
                          {expandedRow === d.id ? '접기' : '미리보기'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expandedRow === d.id && d.payload && (
                    <tr className="bg-neutral-50">
                      <td colSpan={4} className="px-2 py-2">
                        <PayloadPreview platform={d.platform} payload={d.payload} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {result.blog_queue_id && (
                <tr className="border-t border-neutral-100 bg-blue-50">
                  <td className="px-2 py-1">블로그</td>
                  <td className="px-2 py-1 font-mono text-xs">
                    {result.blog_scheduled_for ? new Date(result.blog_scheduled_for).toLocaleString('ko-KR') : '—'}
                  </td>
                  <td className="px-2 py-1 text-xs" colSpan={2}>매시간 blog-publisher cron</td>
                </tr>
              )}
            </tbody>
          </table>

          {result.card_news_variants.payload && (
            <div className="mt-3 rounded border border-neutral-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>🎴 카드뉴스 5변형 생성 (1~3분 소요, ~$0.42)</span>
                {!cardNewsResult?.ok && (
                  <button
                    onClick={triggerCardNewsVariants}
                    disabled={cardNewsTriggering}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-neutral-300"
                  >
                    {cardNewsTriggering ? '생성 중...' : '생성 시작'}
                  </button>
                )}
              </div>
              {cardNewsResult?.ok && (
                <p className="mt-2 text-xs text-emerald-700">
                  ✓ 5변형 생성 완료 ·
                  {' '}<a href={`/admin/marketing/card-news?group_id=${cardNewsResult.group_id}`} className="underline">
                    결과 보기
                  </a>
                </p>
              )}
              {cardNewsResult && !cardNewsResult.ok && (
                <p className="mt-2 text-xs text-red-700">실패: {cardNewsResult.error}</p>
              )}
            </div>
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

function PayloadPreview({ platform, payload }: { platform: string; payload: Record<string, unknown> }) {
  if (platform === 'instagram_caption') {
    const cap = payload.caption as string | undefined;
    const tags = (payload.hashtags as string[]) ?? [];
    return (
      <div>
        <pre className="whitespace-pre-wrap text-xs leading-relaxed">{cap}</pre>
        {tags.length > 0 && <div className="mt-2 text-[10px] text-neutral-500">{tags.join(' ')}</div>}
      </div>
    );
  }
  if (platform === 'threads_post') {
    const main = payload.main as string | undefined;
    const thread = (payload.thread as string[]) ?? [];
    return (
      <div className="space-y-2">
        <pre className="whitespace-pre-wrap text-xs leading-relaxed">{main}</pre>
        {thread.map((t, i) => (
          <pre key={i} className="ml-4 whitespace-pre-wrap text-xs leading-relaxed text-neutral-700 border-l-2 border-neutral-300 pl-2">{t}</pre>
        ))}
      </div>
    );
  }
  if (platform === 'meta_ads') {
    const heads = (payload.headlines as string[]) ?? [];
    const texts = (payload.primary_texts as string[]) ?? [];
    return (
      <div className="text-xs">
        <div className="font-semibold">Headlines ({heads.length})</div>
        <ul className="ml-4 list-disc">{heads.slice(0, 3).map((h, i) => <li key={i}>{h}</li>)}</ul>
        <div className="mt-2 font-semibold">Primary text ({texts.length})</div>
        <ul className="ml-4 list-disc">{texts.slice(0, 2).map((t, i) => <li key={i}>{t}</li>)}</ul>
      </div>
    );
  }
  if (platform === 'kakao_channel') {
    return <pre className="whitespace-pre-wrap text-xs leading-relaxed">{(payload.message_text as string) ?? ''}</pre>;
  }
  if (platform === 'google_ads_rsa') {
    const heads = (payload.headlines as string[]) ?? [];
    return (
      <div className="text-xs">
        <div className="font-semibold">Headlines ({heads.length})</div>
        <ul className="ml-4 list-disc">{heads.slice(0, 5).map((h, i) => <li key={i}>{h}</li>)}</ul>
      </div>
    );
  }
  return <pre className="text-xs">{JSON.stringify(payload, null, 2).slice(0, 500)}</pre>;
}
