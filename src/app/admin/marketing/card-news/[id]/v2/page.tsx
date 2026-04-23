'use client';

/**
 * Card News V2 Studio
 *
 * 아키텍처:
 *   - 기존 V1 에디터와 별도 경로. V1 편집 그대로 사용 가능.
 *   - V2는 "family + 포맷 조합 → Satori 다중 렌더 → 다운로드/블로그/인스타 재사용"
 *   - 편집 UI는 간결. 슬라이드 텍스트 수정은 V1 에디터에 두고, V2는 출력물 생성 주도.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { TemplateFamily } from '@/lib/validators/content-brief';
import type { FormatKey } from '@/lib/card-news/v2/types';

const FAMILY_OPTIONS: Array<{ value: TemplateFamily; label: string; desc: string }> = [
  { value: 'editorial', label: 'Editorial', desc: '하얀 카드 · 정갈한 인포그래픽' },
  { value: 'cinematic', label: 'Cinematic', desc: '풀이미지 · 강한 scrim · 오렌지' },
  { value: 'premium', label: 'Premium', desc: '블랙 + 골드 보더 · 럭셔리' },
  { value: 'bold', label: 'Bold', desc: '네이비→골드 그라디언트 · 특가 강조' },
];

const FORMAT_OPTIONS: Array<{ value: FormatKey; label: string; ratio: string }> = [
  { value: '1x1',  label: '피드 1:1',    ratio: '1080×1080' },
  { value: '4x5',  label: '피드 4:5',    ratio: '1080×1350' },
  { value: '9x16', label: '릴스/스토리', ratio: '1080×1920' },
  { value: 'blog', label: '블로그 16:9', ratio: '1200×675' },
];

interface CardNews {
  id: string;
  title: string;
  slides: Array<Record<string, unknown>>;
  template_family?: TemplateFamily;
  template_version?: string;
  brand_kit_id?: string;
  package_id?: string | null;
}

interface RenderResult {
  slide_index: number;
  format: FormatKey;
  url: string | null;
  error?: string;
  stack?: string;
}

export default function CardNewsV2Studio() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [cardNews, setCardNews] = useState<CardNews | null>(null);
  const [loading, setLoading] = useState(true);
  const [family, setFamily] = useState<TemplateFamily>('editorial');
  const [formats, setFormats] = useState<FormatKey[]>(['1x1']);
  const [rendering, setRendering] = useState(false);
  const [renderResults, setRenderResults] = useState<RenderResult[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [variantBusy, setVariantBusy] = useState<TemplateFamily | null>(null);
  const [diagnostics, setDiagnostics] = useState<Array<{ step: string; ok: boolean; err?: string; stack?: string }> | null>(null);
  const [critiquing, setCritiquing] = useState(false);
  const [critique, setCritique] = useState<{
    overall_score: number;
    dimensions: Record<string, number>;
    issues: Array<{ severity: string; slot: string; problem: string; suggestion: string }>;
    rewritten_cover?: { headline?: string | null; body?: string | null; eyebrow?: string | null } | null;
    verdict: string;
  } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/card-news/${id}`);
        if (res.ok) {
          const { card_news } = await res.json();
          setCardNews(card_news);
          if (card_news?.template_family) {
            setFamily(card_news.template_family as TemplateFamily);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const toggleFormat = (f: FormatKey) => {
    setFormats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  };

  const handleRender = async () => {
    if (formats.length === 0) {
      showToast('최소 1개 포맷을 선택하세요');
      return;
    }
    setRendering(true);
    setRenderResults([]);
    setDiagnostics(null);
    try {
      const res = await fetch('/api/card-news/render-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_news_id: id, formats, family }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.diagnostics)) setDiagnostics(data.diagnostics);
        throw new Error(data.error || '렌더 실패');
      }
      setRenderResults(data.renders ?? []);
      const ok = (data.renders as RenderResult[]).filter((r) => r.url).length;
      const fail = (data.renders as RenderResult[]).filter((r) => !r.url).length;
      showToast(`렌더 완료: 성공 ${ok} / 실패 ${fail}`);

      // card_news에 family 저장 (UX: 다음 렌더 때 동일 family 기본값)
      if (cardNews && cardNews.template_family !== family) {
        await fetch(`/api/card-news/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_family: family, template_version: 'v2' }),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '렌더 실패';
      showToast(msg);
    } finally {
      setRendering(false);
    }
  };

  const handleDownloadZip = async () => {
    const urls = renderResults.filter((r) => r.url).map((r) => r.url as string);
    if (urls.length === 0) {
      showToast('다운로드할 렌더 결과가 없습니다');
      return;
    }
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const r of renderResults) {
        if (!r.url) continue;
        const blob = await (await fetch(r.url)).blob();
        zip.file(`${cardNews?.title || '카드뉴스'}_${r.format}_${r.slide_index + 1}.png`, blob);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.download = `${cardNews?.title || '카드뉴스'}_V2.zip`;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '다운로드 실패';
      showToast(msg);
    }
  };

  const handleCoverCritic = async () => {
    setCritiquing(true);
    setCritique(null);
    try {
      const res = await fetch('/api/content/cover-critic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_news_id: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '비평 실패');
      setCritique(data.critique);
      showToast(`Cover 점수: ${data.critique.overall_score}/100`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '비평 실패');
    } finally {
      setCritiquing(false);
    }
  };

  const handleCreateVariant = async (targetFamily: TemplateFamily) => {
    if (targetFamily === family) {
      showToast('현재 family와 동일합니다');
      return;
    }
    setVariantBusy(targetFamily);
    try {
      const res = await fetch(`/api/card-news/${id}/create-variant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family: targetFamily }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'variant 생성 실패');
      showToast(data.reused ? '기존 variant로 이동' : 'variant 생성 완료');
      router.push(`/admin/marketing/card-news/${data.variant_card_news_id}/v2`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'variant 생성 실패';
      showToast(msg);
    } finally {
      setVariantBusy(null);
    }
  };

  if (loading) {
    return <div className="p-10 text-slate-500">로딩 중...</div>;
  }
  if (!cardNews) {
    return <div className="p-10 text-red-500">카드뉴스를 찾을 수 없습니다</div>;
  }

  const slideCount = cardNews.slides?.length ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-xs text-slate-400 mb-1">V2 Studio</div>
          <h1 className="text-2xl font-bold text-slate-900">{cardNews.title}</h1>
          <div className="text-sm text-slate-500 mt-1">
            슬라이드 {slideCount}장 · 버전 {cardNews.template_version ?? 'v1'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {cardNews.package_id && (
            <button
              type="button"
              onClick={() => router.push(`/admin/products/${cardNews.package_id}/distribute`)}
              className="px-3 py-2 text-sm bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded font-semibold"
              title="IG 캡션 + Threads 포스트 생성"
            >
              Content Distribute →
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push(`/admin/marketing/card-news/${id}`)}
            className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded"
          >
            ← V1 에디터로
          </button>
        </div>
      </div>

      {/* Family + Format */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg p-5 border border-slate-200">
          <div className="text-sm font-bold text-slate-900 mb-3">1. 템플릿 family</div>
          <div className="space-y-2">
            {FAMILY_OPTIONS.map((f) => (
              <label
                key={f.value}
                className={`flex items-start gap-3 p-3 rounded border cursor-pointer ${
                  family === f.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
                }`}
              >
                <input
                  type="radio"
                  name="family"
                  value={f.value}
                  checked={family === f.value}
                  onChange={() => setFamily(f.value)}
                  className="mt-1"
                />
                <div>
                  <div className="font-semibold text-slate-900">{f.label}</div>
                  <div className="text-xs text-slate-500">{f.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg p-5 border border-slate-200">
          <div className="text-sm font-bold text-slate-900 mb-3">2. 출력 포맷 (복수 선택)</div>
          <div className="space-y-2">
            {FORMAT_OPTIONS.map((f) => (
              <label
                key={f.value}
                className={`flex items-center gap-3 p-3 rounded border cursor-pointer ${
                  formats.includes(f.value) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={formats.includes(f.value)}
                  onChange={() => toggleFormat(f.value)}
                />
                <div className="flex-1">
                  <div className="font-semibold text-slate-900">{f.label}</div>
                  <div className="text-xs text-slate-500">{f.ratio}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 실행 버튼 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleRender}
          disabled={rendering || formats.length === 0}
          className="px-5 py-2.5 bg-blue-600 text-white rounded font-semibold disabled:opacity-50"
        >
          {rendering ? '렌더 중...' : `Satori로 렌더 (${slideCount * formats.length}개)`}
        </button>
        {renderResults.length > 0 && (
          <button
            type="button"
            onClick={handleDownloadZip}
            className="px-5 py-2.5 bg-emerald-600 text-white rounded font-semibold"
          >
            ZIP 다운로드
          </button>
        )}
        <button
          type="button"
          onClick={handleCoverCritic}
          disabled={critiquing}
          className="ml-auto px-4 py-2.5 bg-purple-700 text-white rounded font-semibold disabled:opacity-50"
          title="Claude Sonnet 으로 Cover 슬라이드 품질 비평"
        >
          {critiquing ? 'Critic 중…' : '🎯 Cover Critic (Sonnet)'}
        </button>
      </div>

      {/* Critic 결과 */}
      {critique && (
        <div className="bg-white border border-purple-200 rounded-lg p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-purple-700">COVER CRITIC</span>
              <span className={`text-3xl font-black ${critique.overall_score >= 80 ? 'text-emerald-600' : critique.overall_score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                {critique.overall_score}
              </span>
              <span className="text-xs text-slate-500">/ 100</span>
              <span className={`ml-2 px-2 py-0.5 text-xs rounded font-semibold ${
                critique.verdict === 'ship_as_is' ? 'bg-emerald-100 text-emerald-800'
                : critique.verdict === 'minor_polish' ? 'bg-amber-100 text-amber-800'
                : 'bg-red-100 text-red-800'
              }`}>
                {critique.verdict === 'ship_as_is' ? '즉시 발행 OK' : critique.verdict === 'minor_polish' ? '미세 조정 필요' : '재생성 권장'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCritique(null)}
              className="text-slate-400 hover:text-slate-600 text-sm"
            >
              닫기
            </button>
          </div>

          <div className="grid grid-cols-5 gap-3 mb-4 text-xs">
            {Object.entries(critique.dimensions).map(([k, v]) => (
              <div key={k} className="bg-slate-50 rounded p-2 text-center">
                <div className="text-slate-500">{k}</div>
                <div className="text-lg font-bold text-slate-900">{v}<span className="text-xs text-slate-400">/10</span></div>
              </div>
            ))}
          </div>

          {critique.issues.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-bold text-slate-700 mb-2">지적사항</div>
              {critique.issues.map((issue, i) => (
                <div key={i} className="text-xs bg-slate-50 rounded p-2 mb-1">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] mr-2 font-bold ${
                    issue.severity === 'critical' ? 'bg-red-100 text-red-700' :
                    issue.severity === 'major' ? 'bg-amber-100 text-amber-700' :
                    'bg-slate-200 text-slate-600'
                  }`}>
                    {issue.severity.toUpperCase()}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500">{issue.slot}</span>
                  <div className="mt-1 text-slate-700">{issue.problem}</div>
                  <div className="mt-1 text-emerald-700">→ {issue.suggestion}</div>
                </div>
              ))}
            </div>
          )}

          {critique.rewritten_cover && (
            <div className="bg-purple-50 border border-purple-200 rounded p-3 text-xs">
              <div className="font-bold text-purple-900 mb-2">재작성 제안</div>
              {critique.rewritten_cover.eyebrow && <div><span className="text-slate-500">eyebrow:</span> {critique.rewritten_cover.eyebrow}</div>}
              {critique.rewritten_cover.headline && <div><span className="text-slate-500">headline:</span> {critique.rewritten_cover.headline}</div>}
              {critique.rewritten_cover.body && <div><span className="text-slate-500">body:</span> {critique.rewritten_cover.body}</div>}
            </div>
          )}
        </div>
      )}

      {/* A/B variant 생성 */}
      <div className="bg-white rounded-lg p-5 border border-slate-200 mb-6">
        <div className="text-sm font-bold text-slate-900 mb-1">3. A/B variant 생성</div>
        <div className="text-xs text-slate-500 mb-3">
          같은 텍스트로 다른 family 렌더를 만들어 클릭률 비교에 사용. variant가 이미 있으면 해당 페이지로 이동.
        </div>
        <div className="flex flex-wrap gap-2">
          {FAMILY_OPTIONS.filter((f) => f.value !== family).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => handleCreateVariant(f.value)}
              disabled={variantBusy === f.value}
              className="px-3 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
            >
              {variantBusy === f.value ? '...' : `+ ${f.label} variant`}
            </button>
          ))}
        </div>
      </div>

      {/* 진단 결과 (전체 실패 시) */}
      {diagnostics && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-5 mb-6">
          <div className="text-sm font-bold text-red-900 mb-2">진단 단계 실패</div>
          <div className="space-y-2">
            {diagnostics.map((d, i) => (
              <div key={i} className="text-xs">
                <div className={d.ok ? 'text-emerald-700' : 'text-red-700 font-semibold'}>
                  {d.ok ? '✅' : '❌'} {d.step}
                </div>
                {!d.ok && d.err && (
                  <div className="text-red-600 whitespace-pre-wrap break-all mt-1 ml-4">{d.err}</div>
                )}
                {!d.ok && d.stack && (
                  <details className="ml-4 mt-1">
                    <summary className="cursor-pointer text-[10px] text-red-400">stack</summary>
                    <pre className="text-[9px] whitespace-pre-wrap break-all text-red-400">{d.stack}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 렌더 결과 */}
      {renderResults.length > 0 && (
        <div className="bg-white rounded-lg p-5 border border-slate-200">
          <div className="text-sm font-bold text-slate-900 mb-3">렌더 결과</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {renderResults.map((r, i) => (
              <div key={i} className="border border-slate-200 rounded overflow-hidden">
                {r.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.url} alt={`${r.format} slide ${r.slide_index + 1}`} className="w-full" />
                ) : (
                  <div className="aspect-square bg-red-50 flex flex-col items-start justify-start text-xs text-red-700 p-3 overflow-auto">
                    <div className="font-bold mb-1">실패</div>
                    <div className="mb-2 whitespace-pre-wrap break-all">{r.error || '(에러 없음)'}</div>
                    {r.stack && (
                      <details className="w-full">
                        <summary className="cursor-pointer text-[10px] text-red-500">stack</summary>
                        <pre className="text-[9px] whitespace-pre-wrap break-all mt-1 text-red-400">{r.stack}</pre>
                      </details>
                    )}
                  </div>
                )}
                <div className="p-2 text-xs text-slate-500 bg-slate-50">
                  {r.format} · 슬라이드 {r.slide_index + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-4 py-2 rounded shadow-lg text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
