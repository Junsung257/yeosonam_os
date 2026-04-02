'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
// html-to-image, jszip: 내보내기 시점에만 동적 로드
import type { CardNews, CardNewsSlide } from '@/lib/supabase';

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
  DRAFT: 'bg-slate-100 text-slate-500',
  CONFIRMED: 'bg-blue-50 text-blue-700',
  LAUNCHED: 'bg-emerald-50 text-emerald-700',
  ARCHIVED: 'bg-red-50 text-red-500',
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안', CONFIRMED: '컨펌', LAUNCHED: '런치됨', ARCHIVED: '보관',
};

interface PexelsSimple { id: number; src_medium: string; src_large2x: string; alt: string; }

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
  const [pexelsPhotos, setPexelsPhotos] = useState<PexelsSimple[]>([]);
  const [pexelsKeyword, setPexelsKeyword] = useState('');
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [pexelsPage, setPexelsPage] = useState(1);
  const [showPexels, setShowPexels] = useState(false);
  const [budgetKrw, setBudgetKrw] = useState(50000);
  const [toast, setToast] = useState<string | null>(null);

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

  const handleLaunch = async () => {
    if (!confirm(`Meta Ads에 배포하시겠습니까?\n일일 예산: ${budgetKrw.toLocaleString()}원`)) return;
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

  if (!cardNews) {
    return <div className="p-10 text-center text-[13px] text-slate-400">불러오는 중...</div>;
  }

  const ratio = RATIO_SIZES[aspectRatio];

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col -mx-4 lg:-mx-6 -my-4">
      {/* ── 상단 툴바 ──────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/admin/marketing/card-news')}
            className="text-slate-400 hover:text-slate-600 transition p-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <input
            value={cardNews.title}
            onChange={e => setCardNews(cn => cn ? { ...cn, title: e.target.value } : cn)}
            className="text-[15px] font-semibold text-slate-800 bg-transparent border-none outline-none w-64"
          />
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${STATUS_BADGE[cardNews.status]}`}>
            {STATUS_LABELS[cardNews.status]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 비율 선택 */}
          <div className="flex border border-slate-200 rounded overflow-hidden">
            {(Object.keys(RATIO_SIZES) as AspectRatio[]).map(r => (
              <button key={r} onClick={() => setAspectRatio(r)}
                className={`px-2.5 py-1 text-[11px] transition ${aspectRatio === r ? 'bg-[#001f3f] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                {r}
              </button>
            ))}
          </div>
          {/* 일예산 */}
          <div className="flex items-center gap-1 border border-slate-200 rounded px-2 py-1">
            <span className="text-[10px] text-slate-400">일예산</span>
            <input type="number" value={budgetKrw} onChange={e => setBudgetKrw(parseInt(e.target.value) || 50000)}
              step={10000} min={10000} className="w-20 border-none text-[12px] text-slate-800 text-right focus:ring-0 bg-transparent p-0" />
            <span className="text-[10px] text-slate-400">원</span>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-[12px] rounded hover:bg-slate-50 disabled:opacity-50 transition">
            {saving ? '...' : '저장'}
          </button>
          <button onClick={handleExport} disabled={exporting}
            className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-[12px] rounded hover:bg-slate-50 disabled:opacity-50 transition">
            {exporting ? '생성 중...' : 'JPG 내보내기'}
          </button>
          <button onClick={handleLaunch} disabled={launching || cardNews.status === 'LAUNCHED'}
            className="px-3 py-1.5 bg-[#001f3f] text-white text-[12px] rounded hover:bg-blue-900 disabled:opacity-50 transition font-medium">
            {launching ? '배포 중...' : cardNews.status === 'LAUNCHED' ? '런치됨' : '컨펌 & 런치'}
          </button>
        </div>
      </div>

      {launchResult && (
        <div className={`px-4 py-2 text-[12px] ${launchResult.includes('완료') || launchResult.includes('CONFIRMED') ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {launchResult}
        </div>
      )}

      {/* ── 메인 영역 ──────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* 좌측: 슬라이드 목록 */}
        <div className="w-40 bg-slate-50 border-r border-slate-200 flex flex-col overflow-y-auto flex-shrink-0">
          <div className="p-2 text-[11px] font-medium text-slate-400 border-b border-slate-200">
            슬라이드 ({slides.length}장)
          </div>
          {slides.map((s, idx) => (
            <button key={s.id} onClick={() => setActiveIdx(idx)}
              className={`relative group text-left p-1.5 border-b border-slate-100 hover:bg-blue-50/50 transition ${activeIdx === idx ? 'bg-blue-50 border-l-2 border-l-[#005d90]' : ''}`}>
              <div className={`w-full ${ratio.cls} rounded overflow-hidden bg-slate-200`}
                style={s.bg_image_url ? { backgroundImage: `url(${s.bg_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
                {!s.bg_image_url && <div className="w-full h-full flex items-center justify-center text-orange-400 text-[10px]">🖼 이미지 필요</div>}
              </div>
              <p className="text-[10px] text-slate-600 truncate mt-1">{s.headline || `슬라이드 ${idx + 1}`}</p>
              <div className="absolute top-0.5 right-0.5 hidden group-hover:flex gap-0.5">
                {idx > 0 && <button onClick={e => { e.stopPropagation(); moveSlide(idx, 'up'); }} className="w-4 h-4 bg-white rounded text-slate-400 text-[9px] hover:bg-slate-100 border border-slate-200">↑</button>}
                {idx < slides.length - 1 && <button onClick={e => { e.stopPropagation(); moveSlide(idx, 'down'); }} className="w-4 h-4 bg-white rounded text-slate-400 text-[9px] hover:bg-slate-100 border border-slate-200">↓</button>}
                <button onClick={e => { e.stopPropagation(); duplicateSlide(idx); }} className="w-4 h-4 bg-white rounded text-slate-400 text-[9px] hover:bg-slate-100 border border-slate-200">+</button>
                <button onClick={e => { e.stopPropagation(); deleteSlide(idx); }} className="w-4 h-4 bg-red-50 rounded text-red-400 text-[9px] hover:bg-red-100 border border-red-200">x</button>
              </div>
            </button>
          ))}
          <button onClick={addSlide} className="m-2 py-2 text-[11px] text-slate-400 border border-dashed border-slate-300 rounded hover:border-slate-400 hover:text-slate-500 transition">
            + 추가
          </button>
        </div>

        {/* 중앙: 메인 캔버스 */}
        <div className="flex-1 bg-slate-100 overflow-auto flex items-start justify-center p-6">
          {activeSlide ? (
            <div className="card-news-export-slide relative rounded-lg overflow-hidden shadow-lg"
              style={{ width: `${ratio.w}px`, height: `${ratio.h}px`,
                background: activeSlide.bg_image_url ? undefined : 'linear-gradient(135deg, #001f3f, #005d90)',
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
                      fontFamily: (activeSlide as any).headline_style?.fontFamily || 'Pretendard',
                      fontSize: ((activeSlide as any).headline_style?.fontSize || 32) + 'px',
                      color: (activeSlide as any).headline_style?.color || '#ffffff',
                      fontWeight: (activeSlide as any).headline_style?.fontWeight || 'bold',
                      textAlign: ((activeSlide as any).headline_style?.textAlign || 'center') as 'left' | 'center' | 'right',
                    }}
                    className="leading-tight outline-none focus:bg-yellow-50/20 rounded mb-2">
                    {activeSlide.headline}
                  </h2>
                  <p contentEditable suppressContentEditableWarning
                    onBlur={e => updateActiveSlide({ body: e.currentTarget.textContent || '' })}
                    style={{
                      fontFamily: (activeSlide as any).body_style?.fontFamily || 'Pretendard',
                      fontSize: ((activeSlide as any).body_style?.fontSize || 18) + 'px',
                      color: (activeSlide as any).body_style?.color || '#e0e0e0',
                      fontWeight: (activeSlide as any).body_style?.fontWeight || 'normal',
                      textAlign: ((activeSlide as any).body_style?.textAlign || 'center') as 'left' | 'center' | 'right',
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
            <p className="text-slate-400 text-[13px]">슬라이드를 선택하세요</p>
          )}
        </div>

        {/* 우측: 속성 패널 */}
        <div className="w-60 bg-white border-l border-slate-200 overflow-y-auto p-3 space-y-4 flex-shrink-0">
          {activeSlide ? (
            <>
              {/* 오버레이 */}
              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1.5">오버레이</label>
                <select value={activeSlide.overlay_style}
                  onChange={e => updateActiveSlide({ overlay_style: e.target.value as OverlayStyle })}
                  className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] focus:ring-1 focus:ring-[#005d90]">
                  {(Object.keys(OVERLAY_LABELS) as OverlayStyle[]).map(k => (
                    <option key={k} value={k}>{OVERLAY_LABELS[k]}</option>
                  ))}
                </select>
              </div>

              {/* 텍스트 */}
              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1.5">제목</label>
                <input value={activeSlide.headline} onChange={e => updateActiveSlide({ headline: e.target.value })}
                  className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] focus:ring-1 focus:ring-[#005d90]" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase block mb-1.5">본문</label>
                <textarea value={activeSlide.body} onChange={e => updateActiveSlide({ body: e.target.value })}
                  rows={4} className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px] focus:ring-1 focus:ring-[#005d90] resize-none" />
              </div>

              {/* 제목 스타일링 */}
              <div className="border border-slate-200 rounded-lg p-2.5 space-y-2">
                <label className="text-[10px] font-semibold text-slate-400 uppercase block">제목 스타일</label>
                <select value={(activeSlide as any).headline_style?.fontFamily || 'Pretendard'}
                  onChange={e => updateActiveSlide({ headline_style: { ...(activeSlide as any).headline_style, fontFamily: e.target.value } } as any)}
                  className="w-full border border-slate-200 rounded px-2 py-1 text-[11px]">
                  {['Pretendard', 'Noto Sans KR', 'Gothic A1'].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-400 w-6">크기</span>
                  <input type="range" min={16} max={72} value={(activeSlide as any).headline_style?.fontSize || 32}
                    onChange={e => updateActiveSlide({ headline_style: { ...(activeSlide as any).headline_style, fontSize: parseInt(e.target.value) } } as any)}
                    className="flex-1 accent-[#001f3f]" />
                  <span className="text-[10px] text-slate-500 w-8 text-right">{(activeSlide as any).headline_style?.fontSize || 32}px</span>
                </div>
                <div className="flex gap-1">
                  {['#ffffff','#000000','#fbbf24','#ef4444','#22c55e','#3b82f6','#8b5cf6','#ec4899'].map(c => (
                    <button key={c} onClick={() => updateActiveSlide({ headline_style: { ...(activeSlide as any).headline_style, color: c } } as any)}
                      className={`w-5 h-5 rounded-full border transition ${(activeSlide as any).headline_style?.color === c ? 'border-[#001f3f] scale-110' : 'border-slate-200'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                  <input type="color" value={(activeSlide as any).headline_style?.color || '#ffffff'}
                    onChange={e => updateActiveSlide({ headline_style: { ...(activeSlide as any).headline_style, color: e.target.value } } as any)}
                    className="w-5 h-5 rounded cursor-pointer" />
                </div>
                <div className="flex gap-0.5">
                  {[
                    { k: 'fontWeight', v: 'bold', label: 'B', active: (activeSlide as any).headline_style?.fontWeight === 'bold' },
                    { k: 'textAlign', v: 'left', label: '좌', active: (activeSlide as any).headline_style?.textAlign === 'left' },
                    { k: 'textAlign', v: 'center', label: '중', active: ((activeSlide as any).headline_style?.textAlign || 'center') === 'center' },
                    { k: 'textAlign', v: 'right', label: '우', active: (activeSlide as any).headline_style?.textAlign === 'right' },
                  ].map((btn, i) => (
                    <button key={i} onClick={() => updateActiveSlide({ headline_style: { ...(activeSlide as any).headline_style, [btn.k]: btn.active && btn.k === 'fontWeight' ? 'normal' : btn.v } } as any)}
                      className={`flex-1 py-1 rounded text-[10px] font-bold transition ${btn.active ? 'bg-[#001f3f] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 본문 스타일링 */}
              <div className="border border-slate-200 rounded-lg p-2.5 space-y-2">
                <label className="text-[10px] font-semibold text-slate-400 uppercase block">본문 스타일</label>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-400 w-6">크기</span>
                  <input type="range" min={10} max={36} value={(activeSlide as any).body_style?.fontSize || 18}
                    onChange={e => updateActiveSlide({ body_style: { ...(activeSlide as any).body_style, fontSize: parseInt(e.target.value) } } as any)}
                    className="flex-1 accent-[#001f3f]" />
                  <span className="text-[10px] text-slate-500 w-8 text-right">{(activeSlide as any).body_style?.fontSize || 18}px</span>
                </div>
                <div className="flex gap-1">
                  {['#ffffff','#e0e0e0','#000000','#fbbf24','#ef4444','#22c55e','#3b82f6'].map(c => (
                    <button key={c} onClick={() => updateActiveSlide({ body_style: { ...(activeSlide as any).body_style, color: c } } as any)}
                      className={`w-5 h-5 rounded-full border transition ${(activeSlide as any).body_style?.color === c ? 'border-[#001f3f] scale-110' : 'border-slate-200'}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>

              {/* 배경 이미지 */}
              <div className="border border-slate-200 rounded-lg p-2.5 space-y-2">
                <label className="text-[10px] font-semibold text-slate-400 uppercase block">배경 이미지</label>
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
                  <input value={pexelsKeyword} onChange={e => setPexelsKeyword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchPexels()}
                    placeholder="키워드 (영문)" className="flex-1 border border-slate-200 rounded px-2 py-1 text-[11px] focus:ring-1 focus:ring-[#005d90]" />
                  <button onClick={() => searchPexels(activeSlide.pexels_keyword || pexelsKeyword)} disabled={pexelsLoading}
                    className="px-2 py-1 bg-[#001f3f] text-white text-[10px] rounded hover:bg-blue-900 disabled:bg-slate-300">
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
                        className="text-[10px] text-slate-400 hover:text-slate-600 disabled:opacity-30">이전</button>
                      <span className="text-[10px] text-slate-400">{pexelsPage}p</span>
                      <button onClick={() => searchPexels(undefined, pexelsPage + 1)}
                        className="text-[10px] text-slate-400 hover:text-slate-600">다음</button>
                    </div>
                  </div>
                )}
              </div>

              {/* 순서 조작 */}
              <div className="flex gap-1">
                <button onClick={() => moveSlide(activeIdx, 'up')} disabled={activeIdx === 0}
                  className="flex-1 text-[10px] py-1.5 border border-slate-200 rounded text-slate-500 hover:bg-slate-50 disabled:opacity-30">위로</button>
                <button onClick={() => duplicateSlide(activeIdx)}
                  className="flex-1 text-[10px] py-1.5 border border-slate-200 rounded text-slate-500 hover:bg-slate-50">복제</button>
                <button onClick={() => moveSlide(activeIdx, 'down')} disabled={activeIdx === slides.length - 1}
                  className="flex-1 text-[10px] py-1.5 border border-slate-200 rounded text-slate-500 hover:bg-slate-50 disabled:opacity-30">아래로</button>
                <button onClick={() => deleteSlide(activeIdx)} disabled={slides.length <= 1}
                  className="px-2 py-1.5 border border-red-200 text-red-400 text-[10px] rounded hover:bg-red-50 disabled:opacity-30">삭제</button>
              </div>
            </>
          ) : (
            <p className="text-slate-400 text-[12px] text-center py-8">슬라이드를 선택하세요</p>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#001f3f] text-white px-5 py-3 rounded-lg text-[13px] shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
