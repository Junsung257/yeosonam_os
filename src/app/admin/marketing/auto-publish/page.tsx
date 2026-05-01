'use client';

/**
 * /admin/marketing/auto-publish — One-stop 자동 발행 패널 (Premium UX/UI)
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
  kakao_channel: '카카오톡',
  google_ads_rsa: 'Google Ads',
  blog_body: '네이버 블로그',
};

export default function AutoPublishPage() {
  const [step, setStep] = useState(1); // 1: 상품선택, 2: 옵션구성, 3: 발행결과
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

  // 디바운스된 상품 검색
  useEffect(() => {
    if (selected) return;
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
        setStep(3);
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
    setStep(1);
  };

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 px-6 py-12 flex flex-col items-center">
      <div className="max-w-4xl w-full space-y-8">
        
        {/* Header */}
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            여소남 자동화 오케스트레이터
          </h1>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            한 번의 클릭으로 마케팅 콘텐츠를 5개 플랫폼에 즉시 생성하고 최적의 시간대에 자동 발행합니다.
          </p>
        </header>

        {/* Stepper */}
        <div className="flex justify-between items-center max-w-xl mx-auto relative">
          <div className="absolute h-0.5 bg-slate-800 top-1/2 left-0 right-0 -z-10" />
          {[1, 2, 3].map((num) => (
            <div
              key={num}
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold border-2 transition-all duration-300 ${
                step >= num
                  ? 'bg-emerald-500 border-emerald-400 text-slate-900 shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                  : 'bg-slate-800 border-slate-700 text-slate-500'
              }`}
            >
              {num}
            </div>
          ))}
        </div>

        {/* Step 1: 상품 선택 */}
        {step === 1 && (
          <section className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-2xl p-8 shadow-2xl transition-all">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="text-emerald-400">01.</span> 홍보할 여행 상품을 선택하세요
            </h2>
            
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="상품명, 목적지 또는 상품코드 입력..."
                className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-3.5 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none shadow-inner"
              />
              {searching && (
                <span className="absolute right-4 top-4 text-xs text-slate-400 animate-pulse">
                  검색 중...
                </span>
              )}
              
              {suggestions.length > 0 && (
                <ul className="absolute z-10 mt-2 w-full bg-slate-900 border border-slate-700 rounded-xl shadow-xl max-h-64 overflow-y-auto divide-y divide-slate-800">
                  {suggestions.map((s) => (
                    <li
                      key={s.id}
                      onClick={() => {
                        setSelected(s);
                        setStep(2);
                      }}
                      className="px-4 py-3 hover:bg-slate-800 cursor-pointer transition-colors flex flex-col"
                    >
                      <span className="font-semibold text-slate-200">{s.title}</span>
                      <span className="text-xs text-slate-400 mt-1">
                        {s.destination || '미지정'} · {s.short_code || '코드없음'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Step 2: 옵션 구성 */}
        {step === 2 && selected && (
          <section className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-2xl p-8 shadow-2xl space-y-6 animate-fade-in">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="text-emerald-400">02.</span> 발행 옵션 구성
            </h2>

            <div className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-200">{selected.title}</h3>
                <p className="text-xs text-slate-400 mt-1">
                  {selected.destination} | {selected.short_code}
                </p>
              </div>
              <button
                onClick={() => setStep(1)}
                className="text-xs text-slate-400 hover:text-emerald-400 transition-colors underline"
              >
                상품 변경
              </button>
            </div>

            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm text-slate-300">테넌트 아이디 (필요시 입력)</span>
                <input
                  type="text"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="tenant-xxxx"
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-2 text-slate-100 text-sm font-mono outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <label className="flex items-center gap-3 bg-slate-900/30 border border-slate-800 hover:border-slate-700 rounded-xl p-4 cursor-pointer transition-all">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => {
                      setDryRun(e.target.checked);
                      if (e.target.checked) setPublishNow(false);
                    }}
                    className="w-4 h-4 accent-emerald-500 text-emerald-500 rounded"
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-200">Dry-Run 테스트 모드</div>
                    <div className="text-xs text-slate-400">콘텐츠 생성만 수행하고 실제 발행 큐에 넣지 않습니다.</div>
                  </div>
                </label>

                <label className="flex items-center gap-3 bg-slate-900/30 border border-slate-800 hover:border-slate-700 rounded-xl p-4 cursor-pointer transition-all">
                  <input
                    type="checkbox"
                    checked={publishNow}
                    onChange={(e) => {
                      setPublishNow(e.target.checked);
                      if (e.target.checked) setDryRun(false);
                    }}
                    className="w-4 h-4 accent-emerald-500 text-emerald-500 rounded"
                  />
                  <div>
                    <div className="text-sm font-semibold text-slate-200">⚡ 즉시 발행</div>
                    <div className="text-xs text-slate-400">최적의 시간 예측(Best Time)을 건너뛰고 즉시 큐를 적재합니다.</div>
                  </div>
                </label>
              </div>
            </div>

            <button
              onClick={submit}
              disabled={loading}
              className="w-full bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-bold py-4 rounded-xl hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/20"
            >
              {loading ? (
                <>
                  <span className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                  <span>생성 중... (약 30~90초 소요)</span>
                </>
              ) : (
                <span>🚀 자동 마케팅 파이프라인 가동</span>
              )}
            </button>

            {error && (
              <div className="bg-red-900/30 border border-red-800 text-red-200 px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}
          </section>
        )}

        {/* Step 3: 발행 결과 */}
        {step === 3 && result && (
          <section className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-2xl p-8 shadow-2xl space-y-6 animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-700 pb-6 gap-4">
              <div>
                <h2 className="text-2xl font-black flex items-center gap-2 text-emerald-400">
                  처리 완료
                </h2>
                <p className="text-sm text-slate-300 mt-1">{result.product_title}</p>
              </div>
              {result.cost_estimate && (
                <div className="bg-slate-900/80 border border-slate-700 px-4 py-2 rounded-xl text-right shadow-inner min-w-[140px]">
                  <div className="text-[10px] text-slate-400 font-semibold tracking-wide uppercase">AI 추정 비용</div>
                  <div className="text-xl font-black text-cyan-400">${result.cost_estimate.total_usd.toFixed(2)}</div>
                </div>
              )}
            </div>

            {result.duplicate_warning && (
              <div className="bg-amber-900/30 border border-amber-800 text-amber-200 px-4 py-3 rounded-xl text-xs">
                ⚠️ 최근 5분 내 동일 상품이 {result.duplicate_warning.recent_count}회 트리거되었습니다.
                (마지막: {new Date(result.duplicate_warning.last_at).toLocaleTimeString('ko-KR')})
              </div>
            )}

            <div className="space-y-4">
              <h3 className="text-lg font-bold text-slate-200">플랫폼별 예약 현황</h3>
              <div className="grid grid-cols-1 gap-3">
                {result.distributions.map((d) => (
                  <div
                    key={d.id}
                    className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col space-y-2 hover:border-slate-700 transition-all"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-100">{PLATFORM_LABEL[d.platform] ?? d.platform}</span>
                      <span className="text-xs font-mono bg-slate-800 text-emerald-400 px-2 py-1 rounded-md border border-slate-700/50">
                        {d.scheduled_for ? new Date(d.scheduled_for).toLocaleString('ko-KR') : '즉시 실행'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-400">
                      <span>
                        {d.slot_source === 'data_driven' ? '📊 데이터 기반 Best Time' : '⏰ 기본 시간대 스케줄링'}
                      </span>
                      {d.payload && (
                        <button
                          onClick={() => setExpandedRow(expandedRow === d.id ? null : d.id)}
                          className="text-cyan-400 hover:underline font-semibold flex items-center gap-1"
                        >
                          {expandedRow === d.id ? '접기' : '생성된 카피 미리보기'}
                        </button>
                      )}
                    </div>
                    {expandedRow === d.id && d.payload && (
                      <div className="mt-2 bg-slate-950/60 rounded-lg p-3 text-xs text-slate-300 border border-slate-800/80 max-h-60 overflow-y-auto">
                        <PayloadPreview platform={d.platform} payload={d.payload} />
                      </div>
                    )}
                  </div>
                ))}

                {/* 블로그 큐 표기 */}
                {result.blog_queue_id && (
                  <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-4 flex flex-col space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-emerald-400">네이버 블로그 (Pillar-Cluster)</span>
                      <span className="text-xs font-mono bg-emerald-900/50 text-emerald-300 px-2 py-1 rounded-md border border-emerald-800">
                        {result.blog_scheduled_for ? new Date(result.blog_scheduled_for).toLocaleString('ko-KR') : '—'}
                      </span>
                    </div>
                    <p className="text-xs text-emerald-200/80">
                      ✓ SEO 최적화 상품 정보성 글 큐 적재 완료. 크론 작업을 통해 자동 품질 게이트 검증 후 발행됩니다.
                    </p>
                  </div>
                )}

                {/* 카드뉴스 5변형 백그라운드 적재 알림 */}
                {result.card_news_variants?.triggered && (
                  <div className="bg-cyan-950/30 border border-cyan-800/50 rounded-xl p-4 flex flex-col space-y-2 animate-pulse">
                    <div className="flex items-center gap-2 text-cyan-400 font-bold">
                      🎴 카드뉴스 5변형 백그라운드 생성 가동 중
                    </div>
                    <p className="text-xs text-cyan-200/80">
                      다양한 소구점(luxury, value 등)을 갖춘 Multi-Variant 카드뉴스가 생성 큐에 적재되었습니다. (약 1~3분 소요)
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={reset}
                className="bg-slate-700 hover:bg-slate-600 text-slate-200 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all"
              >
                새로운 작업 시작
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function PayloadPreview({ platform, payload }: { platform: string; payload: Record<string, unknown> }) {
  if (platform === 'instagram_caption') {
    const cap = payload.caption as string | undefined;
    const tags = (payload.hashtags as string[]) ?? [];
    return (
      <div>
        <pre className="whitespace-pre-wrap font-sans leading-relaxed">{cap}</pre>
        {tags.length > 0 && <div className="mt-2 text-cyan-400 font-semibold">{tags.join(' ')}</div>}
      </div>
    );
  }
  if (platform === 'threads_post') {
    const main = payload.main as string | undefined;
    const thread = (payload.thread as string[]) ?? [];
    return (
      <div className="space-y-2">
        <pre className="whitespace-pre-wrap font-sans leading-relaxed">{main}</pre>
        {thread.map((t, i) => (
          <pre key={i} className="ml-4 whitespace-pre-wrap font-sans leading-relaxed text-slate-400 border-l-2 border-slate-700 pl-2">{t}</pre>
        ))}
      </div>
    );
  }
  if (platform === 'meta_ads') {
    const heads = (payload.headlines as string[]) ?? [];
    const texts = (payload.primary_texts as string[]) ?? [];
    return (
      <div className="space-y-2">
        <div className="font-bold text-slate-200">광고 제목 (Headlines)</div>
        <ul className="list-disc pl-4 space-y-1">{heads.slice(0, 3).map((h, i) => <li key={i}>{h}</li>)}</ul>
        <div className="font-bold text-slate-200 mt-2">광고 본문 (Primary text)</div>
        <ul className="list-disc pl-4 space-y-1">{texts.slice(0, 2).map((t, i) => <li key={i}>{t}</li>)}</ul>
      </div>
    );
  }
  if (platform === 'kakao_channel') {
    return <pre className="whitespace-pre-wrap font-sans leading-relaxed">{(payload.message_text as string) ?? ''}</pre>;
  }
  if (platform === 'google_ads_rsa') {
    const heads = (payload.headlines as string[]) ?? [];
    return (
      <div>
        <div className="font-bold text-slate-200">확장 검색 제목</div>
        <ul className="list-disc pl-4 space-y-1 mt-1">{heads.slice(0, 5).map((h, i) => <li key={i}>{h}</li>)}</ul>
      </div>
    );
  }
  return <pre className="font-mono text-[10px] opacity-80">{JSON.stringify(payload, null, 2)}</pre>;
}
