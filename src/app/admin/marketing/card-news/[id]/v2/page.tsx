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
import InstagramPublishModal from '@/components/admin/InstagramPublishModal';

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
  template_family?: TemplateFamily | 'html';
  template_version?: string;
  brand_kit_id?: string;
  package_id?: string | null;
  status?: 'DRAFT' | 'CONFIRMED' | 'LAUNCHED' | 'ARCHIVED';
  // HTML 모드
  html_raw?: string | null;
  html_generated?: string | null;
  html_usage?: { costUsd?: number; output_tokens?: number; durationMs?: number } | null;
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
  const [confirming, setConfirming] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [critique, setCritique] = useState<{
    overall_score: number;
    dimensions: Record<string, number>;
    issues: Array<{ severity: string; slot: string; problem: string; suggestion: string }>;
    rewritten_cover?: { headline?: string | null; body?: string | null; eyebrow?: string | null } | null;
    verdict: string;
    source?: 'llm' | 'fallback';
    fallback_reason?: 'no_api_key' | 'api_failed' | 'parse_failed' | 'schema_failed';
  } | null>(null);

  // HTML 모드 상태
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [htmlRawText, setHtmlRawText] = useState<string>('');
  const [htmlDirty, setHtmlDirty] = useState(false);
  const [htmlSaving, setHtmlSaving] = useState(false);
  const [htmlRendering, setHtmlRendering] = useState(false);
  const [htmlRegenerating, setHtmlRegenerating] = useState(false);
  const [htmlRenderResults, setHtmlRenderResults] = useState<Array<{
    slide_index: number;
    url: string | null;
    error?: string;
  }>>([]);
  const isHtmlMode = cardNews?.template_family === 'html';

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
          if (card_news?.template_family && card_news.template_family !== 'html') {
            setFamily(card_news.template_family as TemplateFamily);
          }
          if (card_news?.html_generated) {
            setHtmlContent(card_news.html_generated);
            setHtmlDirty(false);
          }
          if (card_news?.html_raw) {
            setHtmlRawText(card_news.html_raw);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleHtmlSave = useCallback(async () => {
    if (!htmlDirty || htmlSaving) return;
    setHtmlSaving(true);
    try {
      const res = await fetch(`/api/card-news/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html_generated: htmlContent }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `저장 실패 (HTTP ${res.status})`);
      }
      setHtmlDirty(false);
      showToast('HTML 저장됨');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '저장 실패');
    } finally {
      setHtmlSaving(false);
    }
  }, [htmlContent, htmlDirty, htmlSaving, id, showToast]);

  const handleHtmlRender = useCallback(async () => {
    if (htmlDirty) {
      showToast('먼저 저장하세요');
      return;
    }
    setHtmlRendering(true);
    setHtmlRenderResults([]);
    try {
      const res = await fetch(`/api/card-news/${id}/render-html-to-png`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale: 2 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `렌더 실패 (HTTP ${res.status})`);
      setHtmlRenderResults(data.renders ?? []);
      const okCount = (data.renders ?? []).filter((r: { url?: string }) => r.url).length;
      showToast(`PNG ${okCount}/6 렌더 완료`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '렌더 실패');
    } finally {
      setHtmlRendering(false);
    }
  }, [htmlDirty, id, showToast]);

  const handleHtmlRegenerate = useCallback(async () => {
    const editedRaw = window.prompt(
      'Claude 로 전체 HTML 재생성합니다.\n\n원문 텍스트를 수정하거나 그대로 사용:',
      htmlRawText,
    );
    if (editedRaw === null) return; // 취소
    if (!editedRaw.trim()) {
      showToast('원문이 비어있습니다');
      return;
    }
    if (!confirm(`Claude 호출 (~3분, 약 $0.28). 진행할까요?`)) return;

    setHtmlRegenerating(true);
    try {
      const res = await fetch('/api/card-news/generate-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: editedRaw,
          card_news_id: id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `재생성 실패 (HTTP ${res.status})`);
      setHtmlContent(data.html);
      setHtmlRawText(editedRaw);
      setHtmlDirty(false);
      showToast(`재생성 완료 ($${data.costUsd?.toFixed(4)})`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '재생성 실패');
    } finally {
      setHtmlRegenerating(false);
    }
  }, [htmlRawText, id, showToast]);

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

  const handleCoverCritic = async (options: { apply?: boolean } = {}) => {
    setCritiquing(true);
    if (!options.apply) setCritique(null);
    try {
      const res = await fetch('/api/content/cover-critic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_news_id: id, apply: !!options.apply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '비평 실패');
      setCritique(data.critique);

      // 폴백이 쓰였으면 UI 에 경고. 특히 no_api_key 는 사장님이 조치해야 함.
      const fallbackReason: string | undefined = data.critique?.fallback_reason;
      if (data.critique?.source === 'fallback') {
        const reasonMsg =
          fallbackReason === 'no_api_key' ? 'GOOGLE_AI_API_KEY 미설정'
          : fallbackReason === 'api_failed' ? 'Gemini API 호출 실패'
          : fallbackReason === 'parse_failed' ? 'Gemini 응답 파싱 실패'
          : fallbackReason === 'schema_failed' ? 'Gemini 응답 스키마 불일치'
          : '결정론적 폴백 사용';
        showToast(`⚠ ${reasonMsg} — 결정론적 비평 사용 중`);
      }

      if (options.apply) {
        if (data.apply?.applied) {
          const changedSlots = Object.keys(data.apply.changes ?? {}).join(', ') || '없음';
          const willAutoRender = renderResults.length > 0 && formats.length > 0;
          showToast(
            willAutoRender
              ? `Cover 자동 적용 완료 (${changedSlots}) — 재렌더 중…`
              : `Cover 자동 적용 완료 (${changedSlots}) — Satori로 렌더 버튼 눌러 확인`,
          );
          // 카드뉴스 재조회해 최신 slides 반영
          const fresh = await fetch(`/api/card-news/${id}`);
          if (fresh.ok) {
            const d = await fresh.json();
            if (d.card_news) setCardNews(d.card_news);
          }
          // 기존에 렌더 결과가 있으면 자동 재렌더 (UI 에서 즉시 시각 반영 확인 가능)
          if (willAutoRender) {
            await handleRender();
          }
        } else {
          // applied=false 이유를 명시해 사용자가 다음 행동을 판단할 수 있게 함
          const reason = data.apply?.reason ?? 'unknown';
          const humanReason =
            reason === 'ship_as_is' ? '이미 ship_as_is — 수정 불필요'
            : reason === 'no_rewrite' ? '재작성 제안 없음 (API 폴백 시 자주 발생)'
            : reason === 'no_diff' ? '기존 문구와 동일 — 변경사항 없음'
            : reason === 'card_news_not_found' ? '카드뉴스 조회 실패'
            : reason === 'no_slides' ? '슬라이드 없음'
            : reason === 'db_update_failed' ? 'DB 저장 실패'
            : reason;
          const score = data.critique.overall_score;
          showToast(`자동 적용 스킵: ${humanReason} · Cover ${score}/100 · ${data.critique.verdict}`);
        }
      } else {
        const score = data.critique.overall_score;
        showToast(`Cover 점수: ${score}/100 · ${data.critique.verdict}`);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '비평 실패');
    } finally {
      setCritiquing(false);
    }
  };

  /**
   * 최종 저장 (status=CONFIRMED). 블로그/인스타/스레드 생성 페이지에서 이 상태 이상만 호출 대상.
   * 이미 CONFIRMED/LAUNCHED 면 DRAFT 로 되돌림 (토글).
   */
  const handleConfirm = async () => {
    if (!cardNews) return;
    setConfirming(true);
    try {
      const currentStatus = cardNews.status ?? 'DRAFT';
      const nextStatus = currentStatus === 'DRAFT' ? 'CONFIRMED' : 'DRAFT';
      const res = await fetch(`/api/card-news/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setCardNews({ ...cardNews, status: nextStatus });
      showToast(
        nextStatus === 'CONFIRMED'
          ? '최종 저장 완료 — 블로그/IG/스레드 생성 시 이 카드뉴스 호출 가능'
          : 'DRAFT 로 되돌림',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : '상태 변경 실패');
    } finally {
      setConfirming(false);
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
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 bg-slate-100 rounded animate-pulse w-48" />
        <div className="flex gap-4">
          <div className="flex-1 bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] aspect-[9/16] animate-pulse" />
          <div className="w-72 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!cardNews) {
    return <div className="p-10 text-red-500">카드뉴스를 찾을 수 없습니다</div>;
  }

  const slideCount = cardNews.slides?.length ?? 0;

  // HTML 모드 (Claude + Puppeteer) — 별도 UI 분기
  if (isHtmlMode) {
    const allHtmlRendered =
      htmlRenderResults.length === 6 && htmlRenderResults.every((r) => r.url);
    return (
      <div className="min-h-screen bg-slate-50 p-6 max-w-[1400px] mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-1">
              HTML Studio · Claude Sonnet 4.6
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{cardNews.title}</h1>
            <div className="text-sm text-slate-500 mt-1">
              버전 {cardNews.template_version ?? 'html-v1'}
              {cardNews.html_usage?.costUsd != null && (
                <> · 누적 비용 ${cardNews.html_usage.costUsd.toFixed(4)}</>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-1 text-xs font-semibold rounded ${
                cardNews.status === 'CONFIRMED'
                  ? 'bg-emerald-100 text-emerald-800'
                  : cardNews.status === 'LAUNCHED'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {cardNews.status ?? 'DRAFT'}
            </span>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming}
              className={`px-3 py-2 text-sm rounded font-semibold disabled:opacity-50 ${
                (cardNews.status ?? 'DRAFT') === 'DRAFT'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
              }`}
            >
              {confirming ? '저장 중…' : (cardNews.status ?? 'DRAFT') === 'DRAFT' ? '✓ 최종 저장' : '↶ DRAFT 로'}
            </button>
            {htmlRenderResults.some((r) => r.url) && (
              <button
                type="button"
                onClick={() => setPublishModalOpen(true)}
                className="px-3 py-2 text-sm bg-gradient-to-br from-pink-500 to-orange-500 text-white rounded font-semibold"
              >
                📷 IG 발행
              </button>
            )}
            <button
              type="button"
              onClick={() => router.push('/admin/marketing/card-news')}
              className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded"
            >
              ← 목록
            </button>
          </div>
        </div>

        {/* 편집 + 미리보기 좌우 분할 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="text-sm font-bold text-slate-900">
                HTML 코드 편집
                {htmlDirty && <span className="ml-2 text-xs text-amber-600">● 미저장</span>}
              </div>
              <div className="text-xs text-slate-500">{htmlContent.length.toLocaleString()} 자</div>
            </div>
            <textarea
              value={htmlContent}
              onChange={(e) => {
                setHtmlContent(e.target.value);
                setHtmlDirty(true);
              }}
              spellCheck={false}
              className="flex-1 w-full px-3 py-2 font-mono text-xs leading-relaxed bg-slate-900 text-slate-100 border-0 focus:outline-none resize-none"
              style={{ minHeight: '600px' }}
              placeholder="<!DOCTYPE html>..."
            />
          </div>

          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 text-sm font-bold text-slate-900">
              실시간 미리보기 ({htmlDirty ? '편집 중' : '저장됨'})
            </div>
            <iframe
              srcDoc={htmlContent}
              title="HTML 미리보기"
              className="w-full"
              style={{ minHeight: '600px', border: 0 }}
            />
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <button
            type="button"
            onClick={handleHtmlSave}
            disabled={!htmlDirty || htmlSaving}
            className="px-5 py-2.5 bg-blue-600 text-white rounded font-semibold disabled:opacity-40"
          >
            {htmlSaving ? '저장 중…' : htmlDirty ? '💾 변경사항 저장' : '✓ 저장됨'}
          </button>
          <button
            type="button"
            onClick={handleHtmlRender}
            disabled={htmlRendering || htmlDirty}
            className="px-5 py-2.5 bg-emerald-600 text-white rounded font-semibold disabled:opacity-40"
            title={htmlDirty ? '먼저 저장하세요' : 'Puppeteer 로 PNG 6장 렌더 + Storage 업로드'}
          >
            {htmlRendering ? 'PNG 렌더 중…(~30초)' : '🖼 PNG 6장 재렌더'}
          </button>
          <button
            type="button"
            onClick={handleHtmlRegenerate}
            disabled={htmlRegenerating}
            className="ml-auto px-5 py-2.5 bg-purple-600 text-white rounded font-semibold disabled:opacity-40"
            title="Claude 로 전체 HTML 재생성 (~3분, 약 $0.28). 원문 텍스트 수정 가능."
          >
            {htmlRegenerating ? 'Claude 재생성 중…' : '🤖 Claude 전체 재생성 ($0.28)'}
          </button>
        </div>

        {/* PNG 결과 그리드 */}
        {htmlRenderResults.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)] p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">
                PNG 렌더 결과 (
                {htmlRenderResults.filter((r) => r.url).length}/{htmlRenderResults.length})
              </h3>
              {allHtmlRendered && (
                <span className="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                  ✓ 인스타 발행 가능
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {htmlRenderResults
                .sort((a, b) => a.slide_index - b.slide_index)
                .map((r) => (
                  <div key={r.slide_index} className="overflow-hidden rounded border border-slate-200">
                    {r.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.url}
                        alt={`슬라이드 ${r.slide_index + 1}`}
                        className="w-full aspect-square object-cover"
                      />
                    ) : (
                      <div className="aspect-square flex items-center justify-center text-xs text-red-600 bg-red-50 p-3 text-center">
                        {r.slide_index + 1}번 실패<br />{r.error}
                      </div>
                    )}
                    <div className="px-2 py-1 text-xs text-slate-500 bg-slate-50 text-center">
                      {String(r.slide_index + 1).padStart(2, '0')} / 06
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* 원문 텍스트 (참고용) */}
        {htmlRawText && (
          <details className="mb-6 bg-white rounded-xl border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
            <summary className="px-4 py-3 cursor-pointer text-sm font-bold text-slate-700">
              📄 생성에 사용된 원문 텍스트 (펼치기)
            </summary>
            <pre className="px-4 pb-4 text-xs text-slate-600 whitespace-pre-wrap font-mono max-h-80 overflow-auto">
              {htmlRawText}
            </pre>
          </details>
        )}

        {toast && (
          <div className="fixed bottom-6 right-6 bg-slate-900 text-white px-4 py-2 rounded shadow-lg text-sm">
            {toast}
          </div>
        )}

        {publishModalOpen && (
          <InstagramPublishModal
            cardNewsId={id}
            defaultCaption={cardNews.title || ''}
            slideImageUrls={htmlRenderResults
              .sort((a, b) => a.slide_index - b.slide_index)
              .filter((r) => r.url)
              .map((r) => r.url as string)}
            onClose={() => setPublishModalOpen(false)}
            onSuccess={(result) => {
              setPublishModalOpen(false);
              showToast(
                result.mode === 'now'
                  ? `IG 즉시 발행 완료 (post_id=${result.post_id?.slice(0, 10)}…)`
                  : `IG 예약 완료: ${result.scheduled_for}`,
              );
            }}
          />
        )}
      </div>
    );
  }

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
          {/* 상태 뱃지 */}
          <span
            className={`px-2 py-1 text-xs font-semibold rounded ${
              cardNews.status === 'CONFIRMED'
                ? 'bg-emerald-100 text-emerald-800'
                : cardNews.status === 'LAUNCHED'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-slate-100 text-slate-500'
            }`}
            title="DRAFT: 작업 중 / CONFIRMED: 최종 저장 (블로그·IG·Threads 호출 가능) / LAUNCHED: 광고까지 집행됨"
          >
            {cardNews.status ?? 'DRAFT'}
          </span>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming}
            className={`px-3 py-2 text-sm rounded font-semibold disabled:opacity-50 ${
              (cardNews.status ?? 'DRAFT') === 'DRAFT'
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            }`}
            title="CONFIRMED 상태로 바꾸면 블로그·IG·스레드 생성 페이지에서 이 카드뉴스를 호출할 수 있습니다"
          >
            {confirming
              ? '저장 중…'
              : (cardNews.status ?? 'DRAFT') === 'DRAFT'
                ? '✓ 최종 저장'
                : '↶ DRAFT 로'}
          </button>
          {/* Satori 렌더 결과가 있을 때만 IG 발행 가능 (공개 URL 필요) */}
          {renderResults.some(r => r.url) && (
            <button
              type="button"
              onClick={() => setPublishModalOpen(true)}
              className="px-3 py-2 text-sm bg-gradient-to-br from-pink-500 to-orange-500 text-white rounded font-semibold"
              title="렌더된 슬라이드를 IG 캐러셀로 즉시/예약 발행"
            >
              📷 IG 발행
            </button>
          )}
          {cardNews.package_id && (
            <button
              type="button"
              onClick={() => router.push(`/admin/products/${cardNews.package_id}/distribute?card_news_id=${id}`)}
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
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleCoverCritic({ apply: false })}
            disabled={critiquing}
            className="px-3 py-2.5 bg-slate-100 text-slate-700 rounded text-sm font-semibold disabled:opacity-50 border border-slate-300"
            title="비평만 실행 — 결과 표시"
          >
            🎯 비평만
          </button>
          <button
            type="button"
            onClick={() => handleCoverCritic({ apply: true })}
            disabled={critiquing}
            className="px-4 py-2.5 bg-purple-700 text-white rounded font-semibold disabled:opacity-50"
            title="Claude Sonnet 비평 + 권장 사항 즉시 적용"
          >
            {critiquing ? 'Critic 중…' : '🎯 비평 + 자동 적용'}
          </button>
        </div>
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

          {critique.source === 'fallback' && (
            <div className="mb-3 p-2 bg-amber-50 border border-amber-300 rounded text-[11px] text-amber-900">
              <span className="font-bold">⚠ 결정론적 폴백 사용 중</span>
              {critique.fallback_reason === 'no_api_key' && ' — GOOGLE_AI_API_KEY 환경변수 미설정'}
              {critique.fallback_reason === 'api_failed' && ' — Gemini API 호출 실패 (.env.local 확인)'}
              {critique.fallback_reason === 'parse_failed' && ' — Gemini 응답 JSON 파싱 실패'}
              {critique.fallback_reason === 'schema_failed' && ' — Gemini 응답이 스키마와 불일치'}
              <div className="text-[10px] text-amber-700 mt-1">
                실제 Gemini 비평이 아닌 규칙 기반 점수/재작성을 사용합니다. 자동 적용은 가능하지만 품질은 제한적입니다.
              </div>
            </div>
          )}

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
              <div className="flex items-center justify-between mb-2">
                <div className="font-bold text-purple-900">재작성 제안</div>
                <button
                  type="button"
                  onClick={() => handleCoverCritic({ apply: true })}
                  disabled={critiquing}
                  className="px-3 py-1 bg-purple-700 text-white rounded text-[11px] font-semibold disabled:opacity-50"
                >
                  {critiquing ? '적용 중…' : '⚡ 바로 적용 + 재렌더'}
                </button>
              </div>
              {critique.rewritten_cover.eyebrow && <div><span className="text-slate-500">eyebrow:</span> {critique.rewritten_cover.eyebrow}</div>}
              {critique.rewritten_cover.headline && <div><span className="text-slate-500">headline:</span> {critique.rewritten_cover.headline}</div>}
              {critique.rewritten_cover.body && <div><span className="text-slate-500">body:</span> {critique.rewritten_cover.body}</div>}
              <div className="mt-2 text-[10px] text-purple-700">
                적용 시 slide[0] 의 헤드라인/본문/eyebrow 를 위 값으로 덮어쓰고 DB 저장. 이후 Satori 재렌더로 시각 반영.
              </div>
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

      {publishModalOpen && (
        <InstagramPublishModal
          cardNewsId={id}
          defaultCaption={cardNews.title || ''}
          slideImageUrls={renderResults.filter(r => r.url).map(r => r.url as string)}
          onClose={() => setPublishModalOpen(false)}
          onSuccess={(result) => {
            setPublishModalOpen(false);
            showToast(
              result.mode === 'now'
                ? `IG 즉시 발행 완료 (post_id=${result.post_id?.slice(0, 10)}…)`
                : `IG 예약 완료: ${result.scheduled_for}`,
            );
          }}
        />
      )}
    </div>
  );
}
