'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
// html-to-image, jszip: 내보내기 시점에만 동적 로드
import type { CardNews, CardNewsSlide } from '@/lib/supabase';
import InstagramPublishModal from '@/components/admin/InstagramPublishModal';

type OverlayStyle = 'dark' | 'light' | 'gradient-bottom' | 'gradient-top';
type AspectRatio = '1:1' | '4:5' | '9:16';

const OVERLAY_CLASSES: Record<OverlayStyle, string> = {
  'dark': 'bg-black/50',
  'light': 'bg-white/30',
  'gradient-bottom': 'bg-gradient-to-t from-black/80 via-black/20 to-transparent',
  'gradient-top': 'bg-gradient-to-b from-black/80 via-black/20 to-transparent',
};

const OVERLAY_LABELS: Record<OverlayStyle, string> = {
  'dark': '어둡게', 'light': '밝게',
  'gradient-bottom': '하단 그라데이션', 'gradient-top': '상단 그라데이션',
};

const RATIO_SIZES: Record<AspectRatio, { w: number; h: number; label: string; cls: string }> = {
  '1:1':  { w: 480, h: 480, label: '정사각 (피드)', cls: 'aspect-square' },
  '4:5':  { w: 480, h: 600, label: '세로 4:5', cls: 'aspect-[4/5]' },
  '9:16': { w: 480, h: 853, label: '스토리/릴스', cls: 'aspect-[9/16]' },
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-admin-surface-2 text-admin-muted',
  CONFIRMED: 'bg-blue-50 text-blue-700',
  LAUNCHED: 'bg-emerald-50 text-emerald-700',
  ARCHIVED: 'bg-red-50 text-red-500',
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안', CONFIRMED: '컨펌', LAUNCHED: '런치됨', ARCHIVED: '보관',
};

interface PexelsSimple { id: number; src_medium: string; src_large2x: string; alt: string; }

type ConfirmAction =
  | {
      kind: 'blog';
      title: string;
      description: string;
      confirmLabel: string;
      tone: 'primary';
      details: Array<{ label: string; value: string }>;
    }
  | {
      kind: 'launch';
      title: string;
      description: string;
      confirmLabel: string;
      tone: 'warning';
      details: Array<{ label: string; value: string }>;
    }
  | {
      kind: 'template';
      title: string;
      description: string;
      confirmLabel: string;
      tone: 'primary';
      details: Array<{ label: string; value: string }>;
      payload: { templateId: string };
    };

export default function CardNewsEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [cardNews, setCardNews] = useState<CardNews | null>(null);
  const [slides, setSlides] = useState<CardNewsSlide[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<string | null>(null);
  const [blogGenerating, setBlogGenerating] = useState(false);
  const [igModalOpen, setIgModalOpen] = useState(false);
  const [pexelsPhotos, setPexelsPhotos] = useState<PexelsSimple[]>([]);
  const [pexelsKeyword, setPexelsKeyword] = useState('');
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [pexelsPage, setPexelsPage] = useState(1);
  const [showPexels, setShowPexels] = useState(false);
  const [budgetKrw, setBudgetKrw] = useState(50000);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const confirmDialogRef = useRef<HTMLDivElement | null>(null);
  const confirmCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmTitleId = 'card-news-confirm-title';
  const confirmDescriptionId = 'card-news-confirm-description';

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const fetchCardNews = useCallback(async () => {
    const res = await fetch(`/api/card-news/${id}`);
    if (res.ok) {
      const { card_news } = await res.json();
      setCardNews(card_news);
      setSlides(card_news.slides ?? []);
    }
  }, [id]);

  useEffect(() => { fetchCardNews(); }, [fetchCardNews]);

  useEffect(() => {
    if (!confirmAction) return undefined;

    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    confirmCancelButtonRef.current?.focus();

    const getFocusableElements = () => Array.from(
      confirmDialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(element => !element.hasAttribute('disabled') && !element.getAttribute('aria-hidden'));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmAction(null);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [confirmAction]);

  const activeSlide = slides[activeIdx];

  // ─ 슬라이드 조작 ──────────────────────────────────────

  const updateActiveSlide = (patch: Partial<CardNewsSlide>) => {
    setSlides(prev => prev.map((s, i) => i === activeIdx ? { ...s, ...patch } : s));
  };

  const addSlide = () => {
    const newSlide: CardNewsSlide = {
      id: crypto.randomUUID(),
      position: slides.length,
      headline: '새 슬라이드',
      body: '내용을 입력하세요',
      bg_image_url: '',
      pexels_keyword: '',
      overlay_style: 'gradient-bottom',
    };
    setSlides(prev => [...prev, newSlide]);
    setActiveIdx(slides.length);
  };

  const duplicateSlide = (idx: number) => {
    const s = slides[idx];
    const copy: CardNewsSlide = { ...s, id: crypto.randomUUID(), position: idx + 1 };
    const newSlides = [...slides.slice(0, idx + 1), copy, ...slides.slice(idx + 1)].map((sl, i) => ({ ...sl, position: i }));
    setSlides(newSlides);
    setActiveIdx(idx + 1);
  };

  const deleteSlide = (idx: number) => {
    if (slides.length <= 1) return;
    const newSlides = slides.filter((_, i) => i !== idx).map((sl, i) => ({ ...sl, position: i }));
    setSlides(newSlides);
    setActiveIdx(Math.min(idx, newSlides.length - 1));
  };

  const moveSlide = (idx: number, dir: 'up' | 'down') => {
    const t = dir === 'up' ? idx - 1 : idx + 1;
    if (t < 0 || t >= slides.length) return;
    const arr = [...slides];
    [arr[idx], arr[t]] = [arr[t], arr[idx]];
    setSlides(arr.map((s, i) => ({ ...s, position: i })));
    setActiveIdx(t);
  };

  // ─ Pexels ──────────────────────────────────────────────

  const searchPexels = async (kw?: string, page = 1) => {
    const keyword = kw ?? pexelsKeyword;
    if (!keyword) return;
    setPexelsLoading(true);
    setPexelsPage(page);
    try {
      const res = await fetch(`/api/card-news/pexels?keyword=${encodeURIComponent(keyword)}&per_page=8&page=${page}`);
      const data = await res.json();
      setPexelsPhotos(data.photos ?? []);
      setShowPexels(true);
    } finally { setPexelsLoading(false); }
  };

  const applyPexelsPhoto = (photo: PexelsSimple) => {
    updateActiveSlide({ bg_image_url: photo.src_large2x, pexels_keyword: pexelsKeyword });
    setShowPexels(false);
  };

  // ─ 저장 / 내보내기 / 런치 ──────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/card-news/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides, title: cardNews?.title }),
      });
      await fetchCardNews();
      showToast('저장 완료');
    } finally { setSaving(false); }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 300));
      const nodes = document.querySelectorAll<HTMLElement>('.card-news-export-slide');
      if (nodes.length === 0) { setExporting(false); return; }
      const name = cardNews?.title || '카드뉴스';

      const { toJpeg } = await import('html-to-image');
      if (nodes.length === 1) {
        const url = await toJpeg(nodes[0], { quality: 0.95, pixelRatio: 3, backgroundColor: '#000' });
        const a = document.createElement('a');
        a.download = `${name}_1.jpg`; a.href = url; a.click();
      } else {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        for (let i = 0; i < nodes.length; i++) {
          const url = await toJpeg(nodes[i], { quality: 0.95, pixelRatio: 3, backgroundColor: '#000' });
          zip.file(`${name}_${i + 1}.jpg`, url.split(',')[1], { base64: true });
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.download = `${name}_${nodes.length}장.zip`;
        a.href = URL.createObjectURL(blob); a.click();
        URL.revokeObjectURL(a.href);
      }
      showToast(`${nodes.length}장 내보내기 완료`);
    } catch { showToast('내보내기 실패'); }
    finally { setExporting(false); }
  };

  // 카드뉴스 슬라이드를 PNG로 캡처 → Supabase Storage 업로드 → URL 반환
  // 경로 1: Satori 서버 렌더 (지원 템플릿만, 실패 시 해당 슬라이드 null 반환)
  // 경로 2: 클라이언트 html-to-image 캡처 (Satori가 null 반환했거나 미지원 템플릿)
  const captureAndUploadSlides = async (): Promise<string[]> => {
    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 300));

    // ── Step A: Satori 서버 렌더 시도 (실패해도 계속 진행) ──
    let satoriUrls: (string | null)[] = [];
    try {
      const res = await fetch('/api/card-news/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_news_id: id }),
      });
      if (res.ok) {
        const data = await res.json();
        satoriUrls = Array.isArray(data.urls) ? data.urls : [];
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          console.warn('[captureAndUploadSlides] Satori 부분 실패:', data.errors);
        }
      } else {
        console.warn('[captureAndUploadSlides] /api/card-news/render 응답 실패:', res.status);
      }
    } catch (err) {
      console.warn('[captureAndUploadSlides] Satori 호출 실패, 전체 DOM 캡처로 진행:', err);
    }

    // ── Step B: DOM 캡처 fallback (Satori가 null인 슬라이드만) ──
    const nodes = document.querySelectorAll<HTMLElement>('.card-news-export-slide');
    if (nodes.length === 0) throw new Error('슬라이드 캡처 대상 없음');

    const needsDomCapture = nodes.length !== satoriUrls.length
      || satoriUrls.some(u => !u);

    let supabase: any = null;
    let toPng: ((node: HTMLElement, options?: Record<string, unknown>) => Promise<string>) | null = null;
    if (needsDomCapture) {
      const htmlToImage = await import('html-to-image');
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
      const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;
      if (!supabaseUrl || !supabaseAnon) throw new Error('Supabase 환경변수 미설정');
      supabase = createClient(supabaseUrl, supabaseAnon);
      toPng = htmlToImage.toPng;
    }

    const uploadedUrls: string[] = [];
    const sources: ('satori' | 'dom')[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const satoriUrl = satoriUrls[i];
      if (satoriUrl) {
        uploadedUrls.push(satoriUrl);
        sources.push('satori');
        continue;
      }

      // DOM 캡처 폴백
      if (!supabase || !toPng) throw new Error('DOM 캡처 준비 실패');
      try {
        const dataUrl = await toPng(nodes[i], { quality: 0.95, pixelRatio: 2, backgroundColor: '#000' });
        const base64 = dataUrl.split(',')[1];
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/png' });

        const path = `${id}/slide-${i + 1}-${Date.now()}.png`;
        const { error: uploadError } = await supabase.storage
          .from('blog-assets')
          .upload(path, blob, { contentType: 'image/png', upsert: true });
        if (uploadError) throw new Error(`슬라이드 ${i + 1} 업로드 실패: ${uploadError.message}`);

        const { data: { publicUrl } } = supabase.storage.from('blog-assets').getPublicUrl(path);
        uploadedUrls.push(publicUrl);
        sources.push('dom');
      } catch (err) {
        console.error(`[captureAndUploadSlides] slide ${i + 1} DOM 캡처 실패:`, err);
        throw err;
      }
    }

    console.log(`[captureAndUploadSlides] 총 ${uploadedUrls.length}장 — satori: ${sources.filter(s => s === 'satori').length}, dom: ${sources.filter(s => s === 'dom').length}`);
    return uploadedUrls;
  };

  const handleConfirmAndGenerateBlog = async (confirmed = false) => {
    if (!confirmed) {
      setConfirmAction({
        kind: 'blog',
        title: '카드뉴스 확정 + 블로그 생성',
        description: '현재 슬라이드를 이미지로 저장하고 블로그 초안을 자동 생성한 뒤 편집 화면으로 이동합니다.',
        confirmLabel: '블로그 생성 시작',
        tone: 'primary',
        details: [
          { label: '카드뉴스', value: cardNews?.title || id },
          { label: '슬라이드', value: `${slides.length.toLocaleString()}장` },
          { label: '상태', value: 'CONFIRMED 저장' },
          { label: '다음 화면', value: '블로그 편집' },
        ],
      });
      return;
    }
    setConfirmAction(null);
    setBlogGenerating(true);
    setLaunchResult(null);
    try {
      // 1. 현재 상태 저장
      await fetch(`/api/card-news/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides, title: cardNews?.title, status: 'CONFIRMED' }),
      });

      // 2. 슬라이드 PNG 캡처 + Storage 업로드
      showToast(`슬라이드 ${slides.length}장 캡처 중...`);
      const slideImageUrls = await captureAndUploadSlides();

      // 3. 블로그 생성 API 호출
      showToast('블로그 AI 생성 중... (10~20초 소요)');
      const res = await fetch('/api/blog/from-card-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_news_id: id, slide_image_urls: slideImageUrls }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '블로그 생성 실패');

      showToast('블로그 생성 완료! 편집 페이지로 이동합니다.');
      setTimeout(() => router.push(`/admin/blog/${data.blog.id}`), 1500);
    } catch (err: any) {
      setLaunchResult(`오류: ${err.message}`);
      showToast(err.message || '실패');
    } finally {
      setBlogGenerating(false);
    }
  };

  const handleLaunch = async (confirmed = false) => {
    if (!confirmed) {
      setConfirmAction({
        kind: 'launch',
        title: 'Meta Ads 배포',
        description: '현재 카드뉴스를 저장하고 Meta Ads 배포 또는 CONFIRMED 상태 저장을 진행합니다.',
        confirmLabel: '배포 진행',
        tone: 'warning',
        details: [
          { label: '카드뉴스', value: cardNews?.title || id },
          { label: '일일 예산', value: `${budgetKrw.toLocaleString()}원` },
          { label: '슬라이드', value: `${slides.length.toLocaleString()}장` },
          { label: '상태', value: 'CONFIRMED/런치' },
        ],
      });
      return;
    }
    setConfirmAction(null);
    setLaunching(true);
    setLaunchResult(null);
    try {
      await fetch(`/api/card-news/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides, title: cardNews?.title }),
      });
      const res = await fetch(`/api/card-news/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_budget_krw: budgetKrw }),
      });
      const data = await res.json();
      if (res.ok) {
        setLaunchResult(data.meta_launched
          ? `Meta 런치 완료! Campaign ID: ${data.meta_campaign_id}`
          : `CONFIRMED 상태로 저장 (Meta API 미설정)`);
      } else {
        setLaunchResult(`오류: ${data.error}`);
      }
      await fetchCardNews();
    } finally { setLaunching(false); }
  };

  const applyTemplateToAllSlides = (templateId: string, confirmed = false) => {
    if (!confirmed) {
      setConfirmAction({
        kind: 'template',
        title: '템플릿 전체 적용',
        description: '현재 선택한 템플릿을 모든 슬라이드에 적용합니다.',
        confirmLabel: '전체 적용',
        tone: 'primary',
        payload: { templateId },
        details: [
          { label: '템플릿', value: templateId },
          { label: '대상', value: `${slides.length.toLocaleString()}장` },
          { label: '현재 슬라이드', value: `${activeIdx + 1}/${slides.length}` },
          { label: '저장', value: '적용 후 별도 저장 필요' },
        ],
      });
      return;
    }
    setConfirmAction(null);
    setSlides(prev => prev.map(s => ({ ...s, template_id: templateId })));
    showToast('전체 슬라이드 적용 완료');
  };

  const executeConfirmAction = () => {
    if (!confirmAction) return;
    if (confirmAction.kind === 'blog') {
      void handleConfirmAndGenerateBlog(true);
      return;
    }
    if (confirmAction.kind === 'launch') {
      void handleLaunch(true);
      return;
    }
    applyTemplateToAllSlides(confirmAction.payload.templateId, true);
  };

  if (!cardNews) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 bg-admin-surface-2 rounded animate-pulse w-56" />
        <div className="flex gap-4">
          <div className="flex-1 bg-admin-surface-2 rounded-admin-md aspect-[9/16] animate-pulse" />
          <div className="w-64 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 bg-admin-surface-2 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const ratio = RATIO_SIZES[aspectRatio];

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col -mx-4 lg:-mx-6 -my-4">
      {/* ── 상단 툴바 ──────────────────────────────── */}
      <div className="bg-white border-b border-admin-border-mid px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button aria-label="카드뉴스 목록으로 돌아가기" onClick={() => router.push('/admin/marketing/card-news')}
            className="text-admin-muted-2 hover:text-admin-muted transition p-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <input
            aria-label="카드뉴스 제목"
            value={cardNews.title}
            onChange={e => setCardNews(cn => cn ? { ...cn, title: e.target.value } : cn)}
            className="text-admin-md font-semibold text-admin-text-2 bg-transparent border-none outline-none w-64"
          />
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${STATUS_BADGE[cardNews.status]}`}>
            {STATUS_LABELS[cardNews.status]}
          </span>
          <button
            type="button"
            onClick={() => router.push(`/admin/marketing/card-news/${id}/v2`)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100"
            title="V2 Studio: Atom 기반 템플릿 family + 다중 포맷 + A/B variant"
          >
            V2 Studio →
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* 비율 선택 */}
          <div className="flex border border-admin-border-mid rounded overflow-hidden">
            {(Object.keys(RATIO_SIZES) as AspectRatio[]).map(r => (
              <button key={r} type="button" aria-pressed={aspectRatio === r} onClick={() => setAspectRatio(r)}
                className={`px-2.5 py-1 text-[11px] transition ${aspectRatio === r ? 'bg-slate-800 text-white' : 'bg-white text-admin-muted hover:bg-admin-bg'}`}>
                {r}
              </button>
            ))}
          </div>
          {/* 일예산 */}
          <div className="flex items-center gap-1 border border-admin-border-mid rounded px-2 py-1">
            <span className="text-[10px] text-admin-muted-2">일예산</span>
            <input aria-label="일예산" type="number" value={budgetKrw} onChange={e => setBudgetKrw(parseInt(e.target.value) || 50000)}
              step={10000} min={10000} className="w-20 border-none text-admin-xs text-admin-text-2 text-right focus:ring-0 bg-transparent p-0" />
            <span className="text-[10px] text-admin-muted-2">원</span>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 bg-white border border-admin-border-strong text-admin-text-2 text-admin-xs rounded hover:bg-admin-bg disabled:opacity-50 transition">
            {saving ? '...' : '저장'}
          </button>
          <button onClick={handleExport} disabled={exporting}
            className="px-3 py-1.5 bg-white border border-admin-border-strong text-admin-text-2 text-admin-xs rounded hover:bg-admin-bg disabled:opacity-50 transition">
            {exporting ? '생성 중...' : 'JPG 내보내기'}
          </button>
          <button onClick={() => void handleConfirmAndGenerateBlog()} disabled={blogGenerating}
            className="px-3 py-1.5 bg-blue-600 text-white text-admin-xs rounded hover:bg-blue-700 disabled:opacity-50 transition font-medium"
            title="카드뉴스를 이미지로 저장하고 블로그를 자동 생성합니다">
            {blogGenerating ? '블로그 생성 중...' : '✨ 확정 + 블로그 생성'}
          </button>
          <button
            onClick={() => setIgModalOpen(true)}
            disabled={!cardNews.slide_image_urls || cardNews.slide_image_urls.length < 2}
            className={`px-3 py-1.5 text-white text-admin-xs rounded disabled:opacity-50 transition font-medium ${
              cardNews.ig_publish_status === 'published' ? 'bg-emerald-600 hover:bg-emerald-700'
              : cardNews.ig_publish_status === 'queued' ? 'bg-amber-500 hover:bg-amber-600'
              : cardNews.ig_publish_status === 'failed' ? 'bg-red-600 hover:bg-red-700'
              : 'bg-rose-500 hover:bg-rose-600'
            }`}
            title={cardNews.slide_image_urls?.length ? '인스타 캐러셀 발행' : '"확정+블로그" 먼저 실행 (슬라이드 PNG 업로드 필요)'}
          >
            {cardNews.ig_publish_status === 'published'
              ? '🟢 인스타 재발행'
              : cardNews.ig_publish_status === 'queued'
                ? '🟡 예약됨'
                : cardNews.ig_publish_status === 'failed'
                  ? '🔴 인스타 재시도'
                  : '📷 인스타 발행'}
          </button>
          <button onClick={() => void handleLaunch()} disabled={launching || cardNews.status === 'LAUNCHED'}
            className="px-3 py-1.5 bg-slate-900 text-white text-admin-xs rounded hover:bg-slate-800 disabled:opacity-50 transition font-medium">
            {launching ? '배포 중...' : cardNews.status === 'LAUNCHED' ? '런치됨' : '컨펌 & 런치'}
          </button>
        </div>
      </div>

      {launchResult && (
        <div className={`px-4 py-2 text-admin-xs ${launchResult.includes('완료') || launchResult.includes('CONFIRMED') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {launchResult}
        </div>
      )}

      {/* ── 메인 영역 ──────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* 좌측: 슬라이드 목록 */}
        <div className="w-40 bg-admin-bg border-r border-admin-border-mid flex flex-col overflow-y-auto flex-shrink-0">
          <div className="p-2 text-[11px] font-medium text-admin-muted-2 border-b border-admin-border-mid">
            슬라이드 ({slides.length}장)
          </div>
          {slides.map((s, idx) => (
            <button key={s.id} onClick={() => setActiveIdx(idx)}
              className={`relative group text-left p-1.5 border-b border-admin-border hover:bg-blue-50/50 transition ${activeIdx === idx ? 'bg-blue-50 border-l-2 border-l-[#005d90]' : ''}`}>
              <div className={`w-full ${ratio.cls} rounded overflow-hidden bg-slate-200`}
                style={s.bg_image_url ? { backgroundImage: `url(${s.bg_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
                {!s.bg_image_url && <div className="w-full h-full flex items-center justify-center text-orange-400 text-[10px]">🖼 이미지 필요</div>}
              </div>
              <p className="text-[10px] text-admin-muted truncate mt-1">{s.headline || `슬라이드 ${idx + 1}`}</p>
              <div className="absolute top-0.5 right-0.5 hidden group-hover:flex gap-0.5">
                {idx > 0 && <button onClick={e => { e.stopPropagation(); moveSlide(idx, 'up'); }} className="w-4 h-4 bg-white rounded text-admin-muted-2 text-[9px] hover:bg-admin-surface-2 border border-admin-border-mid">↑</button>}
                {idx < slides.length - 1 && <button onClick={e => { e.stopPropagation(); moveSlide(idx, 'down'); }} className="w-4 h-4 bg-white rounded text-admin-muted-2 text-[9px] hover:bg-admin-surface-2 border border-admin-border-mid">↓</button>}
                <button onClick={e => { e.stopPropagation(); duplicateSlide(idx); }} className="w-4 h-4 bg-white rounded text-admin-muted-2 text-[9px] hover:bg-admin-surface-2 border border-admin-border-mid">+</button>
                <button onClick={e => { e.stopPropagation(); deleteSlide(idx); }} className="w-4 h-4 bg-red-50 rounded text-red-400 text-[9px] hover:bg-red-100 border border-red-200">x</button>
              </div>
            </button>
          ))}
          <button onClick={addSlide} className="m-2 py-2 text-[11px] text-admin-muted-2 border border-dashed border-admin-border-strong rounded hover:border-slate-400 hover:text-admin-muted transition">
            + 추가
          </button>
        </div>

        {/* 중앙: 메인 캔버스 */}
        <div className="flex-1 bg-admin-surface-2 overflow-auto flex items-start justify-center p-6">
          {activeSlide ? (
            <div className="card-news-export-slide relative rounded-lg overflow-hidden shadow-admin-md"
              style={{ width: `${ratio.w}px`, height: `${ratio.h}px`,
                background: activeSlide.bg_image_url ? undefined : 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                backgroundImage: activeSlide.bg_image_url ? `url(${activeSlide.bg_image_url})` : undefined,
                backgroundSize: 'cover', backgroundPosition: 'center' }}>
              <div className={`absolute inset-0 ${OVERLAY_CLASSES[activeSlide.overlay_style] ?? OVERLAY_CLASSES.dark}`} />
              <div className="absolute inset-0 flex flex-col justify-between p-6 z-10">
                {/* 로고 */}
                <span className="text-white/60 text-[10px] font-bold tracking-widest uppercase">YEOSONAM</span>
                {/* 메인 텍스트 */}
                <div>
                  <h2 contentEditable suppressContentEditableWarning
                    onBlur={e => updateActiveSlide({ headline: e.currentTarget.textContent || '' })}
                    style={{
                      fontFamily: activeSlide.headline_style?.fontFamily || 'Pretendard',
                      fontSize: (activeSlide.headline_style?.fontSize || 32) + 'px',
                      color: activeSlide.headline_style?.color || '#ffffff',
                      fontWeight: activeSlide.headline_style?.fontWeight || 'bold',
                      textAlign: (activeSlide.headline_style?.textAlign || 'center') as 'left' | 'center' | 'right',
                    }}
                    className="leading-tight outline-none focus:bg-yellow-50/20 rounded mb-2">
                    {activeSlide.headline}
                  </h2>
                  <p contentEditable suppressContentEditableWarning
                    onBlur={e => updateActiveSlide({ body: e.currentTarget.textContent || '' })}
                    style={{
                      fontFamily: activeSlide.body_style?.fontFamily || 'Pretendard',
                      fontSize: (activeSlide.body_style?.fontSize || 18) + 'px',
                      color: activeSlide.body_style?.color || '#e0e0e0',
                      fontWeight: activeSlide.body_style?.fontWeight || 'normal',
                      textAlign: (activeSlide.body_style?.textAlign || 'center') as 'left' | 'center' | 'right',
                    }}
                    className="leading-relaxed outline-none focus:bg-yellow-50/20 rounded whitespace-pre-line">
                    {activeSlide.body}
                  </p>
                </div>
                {/* 하단 */}
                <div className="flex justify-between items-end">
                  <span className="text-white/30 text-[9px]">yeosonam.co.kr</span>
                  <span className="bg-black/30 text-white text-[10px] px-2 py-0.5 rounded-full">{activeIdx + 1}/{slides.length}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-admin-muted-2 text-admin-sm">슬라이드를 선택하세요</p>
          )}
        </div>

        {/* 우측: 속성 패널 */}
        <div className="w-60 bg-white border-l border-admin-border-mid overflow-y-auto p-3 space-y-4 flex-shrink-0">
          {activeSlide ? (
            <>
              {/* 디자인 템플릿 선택 (전체 슬라이드 일괄 적용 옵션) */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2.5">
                <label htmlFor={`card-news-template-${activeSlide.id}`} className="text-[10px] font-semibold text-indigo-700 uppercase block mb-1.5">디자인 템플릿</label>
                <select
                  id={`card-news-template-${activeSlide.id}`}
                  value={activeSlide.template_id || ''}
                  onChange={e => {
                    const tplId = e.target.value || undefined;
                    updateActiveSlide({ template_id: tplId });
                  }}
                  className="w-full border border-indigo-200 rounded px-2 py-1.5 text-admin-xs focus:ring-1 focus:ring-indigo-400 bg-white"
                >
                  <option value="">기본 (V1 스타일)</option>
                  <option value="dark_cinematic">🌃 다크 시네마틱</option>
                  <option value="clean_white">📄 클린 화이트</option>
                  <option value="bold_gradient">💎 볼드 그라디언트</option>
                  <option value="magazine">📰 매거진</option>
                  <option value="luxury_gold">✨ 럭셔리 골드</option>
                </select>
                <button
                  onClick={() => {
                    const tplId = activeSlide.template_id;
                    if (!tplId) { showToast('템플릿을 먼저 선택하세요'); return; }
                    applyTemplateToAllSlides(tplId);
                  }}
                  className="w-full mt-1.5 px-2 py-1 bg-blue-600 text-white text-[10px] rounded hover:bg-blue-700"
                >
                  전체 슬라이드에 적용
                </button>
              </div>

              {/* 배지 (옵셔널) */}
              <div>
                <label htmlFor={`card-news-badge-${activeSlide.id}`} className="text-[10px] font-semibold text-admin-muted-2 uppercase block mb-1.5">배지 (옵션)</label>
                <input
                  id={`card-news-badge-${activeSlide.id}`}
                  value={activeSlide.badge || ''}
                  onChange={e => updateActiveSlide({ badge: e.target.value || null })}
                  placeholder="예: 핵심 / TIP / 01"
                  maxLength={10}
                  className="w-full border border-admin-border-mid rounded px-2 py-1.5 text-admin-xs focus:ring-1 focus:ring-[#005d90]"
                />
              </div>

              {/* 오버레이 (V1 호환용 — 템플릿 미선택 시 적용) */}
              <div>
                <label htmlFor={`card-news-overlay-${activeSlide.id}`} className="text-[10px] font-semibold text-admin-muted-2 uppercase block mb-1.5">오버레이 (V1 전용)</label>
                <select id={`card-news-overlay-${activeSlide.id}`} value={activeSlide.overlay_style}
                  onChange={e => updateActiveSlide({ overlay_style: e.target.value as OverlayStyle })}
                  className="w-full border border-admin-border-mid rounded px-2 py-1.5 text-admin-xs focus:ring-1 focus:ring-[#005d90]"
                  disabled={!!activeSlide.template_id}
                  title={activeSlide.template_id ? '템플릿 사용 시 무효' : ''}>
                  {(Object.keys(OVERLAY_LABELS) as OverlayStyle[]).map(k => (
                    <option key={k} value={k}>{OVERLAY_LABELS[k]}</option>
                  ))}
                </select>
              </div>

              {/* 텍스트 */}
              <div>
                <label htmlFor={`card-news-headline-${activeSlide.id}`} className="text-[10px] font-semibold text-admin-muted-2 uppercase block mb-1.5">제목</label>
                <input id={`card-news-headline-${activeSlide.id}`} value={activeSlide.headline} onChange={e => updateActiveSlide({ headline: e.target.value })}
                  className="w-full border border-admin-border-mid rounded px-2 py-1.5 text-admin-xs focus:ring-1 focus:ring-[#005d90]" />
              </div>
              <div>
                <label htmlFor={`card-news-body-${activeSlide.id}`} className="text-[10px] font-semibold text-admin-muted-2 uppercase block mb-1.5">본문</label>
                <textarea id={`card-news-body-${activeSlide.id}`} value={activeSlide.body} onChange={e => updateActiveSlide({ body: e.target.value })}
                  rows={4} className="w-full border border-admin-border-mid rounded px-2 py-1.5 text-admin-xs focus:ring-1 focus:ring-[#005d90] resize-none" />
              </div>

              {/* 제목 스타일링 */}
              <div className="border border-admin-border-mid rounded-lg p-2.5 space-y-2">
                <div className="text-[10px] font-semibold text-admin-muted-2 uppercase block">제목 스타일</div>
                <select aria-label="제목 글꼴" value={activeSlide.headline_style?.fontFamily || 'Pretendard'}
                  onChange={e => updateActiveSlide({ headline_style: { ...activeSlide.headline_style, fontFamily: e.target.value } })}
                  className="w-full border border-admin-border-mid rounded px-2 py-1 text-[11px]">
                  {['Pretendard', 'Noto Sans KR', 'Gothic A1'].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-admin-muted-2 w-6">크기</span>
                  <input aria-label="제목 글자 크기" type="range" min={16} max={72} value={activeSlide.headline_style?.fontSize || 32}
                    onChange={e => updateActiveSlide({ headline_style: { ...activeSlide.headline_style, fontSize: parseInt(e.target.value) } })}
                    className="flex-1 accent-blue-600" />
                  <span className="text-[10px] text-admin-muted w-8 text-right">{activeSlide.headline_style?.fontSize || 32}px</span>
                </div>
                <div className="flex gap-1">
                  {['#ffffff','#000000','#fbbf24','#ef4444','#22c55e','#3b82f6','#8b5cf6','#ec4899'].map(c => (
                    <button key={c} aria-label={`제목 색상 ${c}`} onClick={() => updateActiveSlide({ headline_style: { ...activeSlide.headline_style, color: c } })}
                      className={`w-5 h-5 rounded-full border transition ${activeSlide.headline_style?.color === c ? 'border-blue-600 scale-110' : 'border-admin-border-mid'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                  <input aria-label="제목 사용자 지정 색상" type="color" value={activeSlide.headline_style?.color || '#ffffff'}
                    onChange={e => updateActiveSlide({ headline_style: { ...activeSlide.headline_style, color: e.target.value } })}
                    className="w-5 h-5 rounded cursor-pointer" />
                </div>
                <div className="flex gap-0.5">
                  {[
                    { k: 'fontWeight', v: 'bold', label: 'B', active: activeSlide.headline_style?.fontWeight === 'bold' },
                    { k: 'textAlign', v: 'left', label: '좌', active: activeSlide.headline_style?.textAlign === 'left' },
                    { k: 'textAlign', v: 'center', label: '중', active: (activeSlide.headline_style?.textAlign || 'center') === 'center' },
                    { k: 'textAlign', v: 'right', label: '우', active: activeSlide.headline_style?.textAlign === 'right' },
                  ].map((btn, i) => (
                    <button key={i} type="button" aria-pressed={btn.active} onClick={() => updateActiveSlide({ headline_style: { ...activeSlide.headline_style, [btn.k]: btn.active && btn.k === 'fontWeight' ? 'normal' : btn.v } })}
                      className={`flex-1 py-1 rounded text-[10px] font-bold transition ${btn.active ? 'bg-blue-600 text-white' : 'bg-admin-surface-2 text-admin-muted hover:bg-slate-200'}`}>
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 본문 스타일링 */}
              <div className="border border-admin-border-mid rounded-lg p-2.5 space-y-2">
                <div className="text-[10px] font-semibold text-admin-muted-2 uppercase block">본문 스타일</div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-admin-muted-2 w-6">크기</span>
                  <input aria-label="본문 글자 크기" type="range" min={10} max={36} value={activeSlide.body_style?.fontSize || 18}
                    onChange={e => updateActiveSlide({ body_style: { ...activeSlide.body_style, fontSize: parseInt(e.target.value) } })}
                    className="flex-1 accent-blue-600" />
                  <span className="text-[10px] text-admin-muted w-8 text-right">{activeSlide.body_style?.fontSize || 18}px</span>
                </div>
                <div className="flex gap-1">
                  {['#ffffff','#e0e0e0','#000000','#fbbf24','#ef4444','#22c55e','#3b82f6'].map(c => (
                    <button key={c} aria-label={`본문 색상 ${c}`} onClick={() => updateActiveSlide({ body_style: { ...activeSlide.body_style, color: c } })}
                      className={`w-5 h-5 rounded-full border transition ${activeSlide.body_style?.color === c ? 'border-blue-600 scale-110' : 'border-admin-border-mid'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>

              {/* 배경 이미지 */}
              <div className="border border-admin-border-mid rounded-lg p-2.5 space-y-2">
                <div className="text-[10px] font-semibold text-admin-muted-2 uppercase block">배경 이미지</div>
                {activeSlide.bg_image_url ? (
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={activeSlide.bg_image_url} alt="" className="w-10 h-10 rounded object-cover" />
                    <button onClick={() => updateActiveSlide({ bg_image_url: '' })} className="text-[10px] text-red-500 hover:underline">제거</button>
                  </div>
                ) : (
                  <div className="bg-orange-50 border border-orange-200 rounded p-2 text-[10px] text-orange-600">
                    배경 이미지가 없습니다. 아래에서 검색하거나 자동 검색을 눌러주세요.
                  </div>
                )}
                <div className="flex gap-1">
                  <input aria-label="배경 이미지 검색 키워드" value={pexelsKeyword} onChange={e => setPexelsKeyword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchPexels()}
                    placeholder="키워드 (영문)" className="flex-1 border border-admin-border-mid rounded px-2 py-1 text-[11px] focus:ring-1 focus:ring-[#005d90]" />
                  <button onClick={() => searchPexels(activeSlide.pexels_keyword || pexelsKeyword)} disabled={pexelsLoading}
                    className="px-2 py-1 bg-blue-600 text-white text-[10px] rounded hover:bg-blue-700 disabled:bg-slate-300">
                    {pexelsLoading ? '...' : '검색'}
                  </button>
                </div>
                {activeSlide.pexels_keyword && !activeSlide.bg_image_url && (
                  <button onClick={() => { setPexelsKeyword(activeSlide.pexels_keyword); searchPexels(activeSlide.pexels_keyword); }}
                    disabled={pexelsLoading}
                    className="w-full py-1.5 bg-blue-50 text-blue-600 text-[10px] rounded border border-blue-200 hover:bg-blue-100 disabled:opacity-50">
                    🔍 자동 검색: &quot;{activeSlide.pexels_keyword}&quot;
                  </button>
                )}
                {showPexels && pexelsPhotos.length > 0 && (
                  <div>
                    <div className="grid grid-cols-2 gap-1">
                      {pexelsPhotos.map(p => (
                        <button key={p.id} onClick={() => applyPexelsPhoto(p)}
                          className="overflow-hidden rounded border-2 border-transparent hover:border-[#005d90] transition">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.src_medium} alt={p.alt} className="w-full h-14 object-cover" />
                        </button>
                      ))}
                    </div>
                    <div className="flex justify-between mt-1.5">
                      <button onClick={() => searchPexels(undefined, Math.max(1, pexelsPage - 1))} disabled={pexelsPage <= 1}
                        className="text-[10px] text-admin-muted-2 hover:text-admin-muted disabled:opacity-30">이전</button>
                      <span className="text-[10px] text-admin-muted-2">{pexelsPage}p</span>
                      <button onClick={() => searchPexels(undefined, pexelsPage + 1)}
                        className="text-[10px] text-admin-muted-2 hover:text-admin-muted">다음</button>
                    </div>
                  </div>
                )}
              </div>

              {/* 순서 조작 */}
              <div className="flex gap-1">
                <button onClick={() => moveSlide(activeIdx, 'up')} disabled={activeIdx === 0}
                  className="flex-1 text-[10px] py-1.5 border border-admin-border-mid rounded text-admin-muted hover:bg-admin-bg disabled:opacity-30">위로</button>
                <button onClick={() => duplicateSlide(activeIdx)}
                  className="flex-1 text-[10px] py-1.5 border border-admin-border-mid rounded text-admin-muted hover:bg-admin-bg">복제</button>
                <button onClick={() => moveSlide(activeIdx, 'down')} disabled={activeIdx === slides.length - 1}
                  className="flex-1 text-[10px] py-1.5 border border-admin-border-mid rounded text-admin-muted hover:bg-admin-bg disabled:opacity-30">아래로</button>
                <button onClick={() => deleteSlide(activeIdx)} disabled={slides.length <= 1}
                  className="px-2 py-1.5 border border-red-200 text-red-400 text-[10px] rounded hover:bg-red-50 disabled:opacity-30">삭제</button>
              </div>
            </>
          ) : (
            <p className="text-admin-muted-2 text-admin-xs text-center py-8">슬라이드를 선택하세요</p>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-blue-600 text-white px-5 py-3 rounded-lg text-admin-sm shadow-admin-md">
          {toast}
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex h-dvh max-h-dvh items-end justify-center bg-black/30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:items-center">
          <div
            ref={confirmDialogRef}
            id="card-news-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={confirmTitleId}
            aria-describedby={confirmDescriptionId}
            className="w-full max-w-md overflow-hidden rounded-admin-md border border-admin-border-mid bg-white shadow-admin-lg"
          >
            <div className="border-b border-admin-border-mid px-4 py-3">
              <p id={confirmTitleId} className="text-admin-sm font-semibold text-admin-text-2">{confirmAction.title}</p>
              <p id={confirmDescriptionId} className="mt-1 text-[11px] text-admin-muted">{confirmAction.description}</p>
            </div>
            <div className="space-y-3 px-4 py-3">
              <div className="grid grid-cols-2 gap-2">
                {confirmAction.details.map(item => (
                  <div key={item.label} className="rounded bg-admin-bg px-2.5 py-2">
                    <p className="text-[10px] text-admin-muted-2">{item.label}</p>
                    <p className="mt-0.5 break-words text-admin-sm font-semibold text-admin-text-2">{item.value}</p>
                  </div>
                ))}
              </div>
              {confirmAction.tone === 'warning' && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  외부 광고 배포 또는 예산 사용이 포함될 수 있습니다. 금액과 대상이 맞는지 확인해 주세요.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-admin-border-mid px-4 py-3">
              <button
                ref={confirmCancelButtonRef}
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded border border-admin-border-strong bg-white px-3 py-1.5 text-admin-sm text-admin-text-2 hover:bg-admin-bg"
              >
                취소
              </button>
              <button
                type="button"
                onClick={executeConfirmAction}
                className={`rounded px-3 py-1.5 text-admin-sm font-medium text-white ${
                  confirmAction.tone === 'warning'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instagram 발행 모달 */}
      {igModalOpen && cardNews && (
        <InstagramPublishModal
          cardNewsId={id!}
          slideImageUrls={cardNews.slide_image_urls ?? []}
          defaultCaption={buildDefaultCaption(cardNews, slides)}
          onClose={() => setIgModalOpen(false)}
          onSuccess={(result) => {
            setIgModalOpen(false);
            if (result.mode === 'now') {
              showToast(`🟢 인스타 발행 완료 (post_id: ${result.post_id?.slice(0, 12)}...)`);
            } else {
              showToast(`🟡 ${result.scheduled_for?.slice(0, 10)} 예약 저장됨`);
            }
            // 상태 갱신 위해 카드뉴스 재조회
            fetch(`/api/card-news/${id}`)
              .then(r => r.json())
              .then(d => d?.card_news && setCardNews(d.card_news))
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}

/** 캡션 초기값: 첫 슬라이드 + 지역 해시태그 */
function buildDefaultCaption(cn: CardNews, slides: CardNewsSlide[]): string {
  const headline = slides[0]?.headline ?? cn.title;
  const body = slides[0]?.body ?? '';
  const dest = (cn as unknown as { package_destination?: string }).package_destination;
  const destTags = dest
    ? dest.split(/[\/,·\s]+/).filter(Boolean).slice(0, 3).map(t => `#${t.replace(/[^가-힣a-zA-Z0-9]/g, '')}`).join(' ')
    : '';
  const commonTags = '#여소남 #여행스타그램 #해외여행 #패키지여행';
  return [headline, '', body, '', destTags, commonTags].filter(Boolean).join('\n').slice(0, 2200);
}
