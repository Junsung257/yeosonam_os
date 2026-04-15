'use client';

import { useState, useCallback } from 'react';
// html-to-image, jszip: 내보내기 시점에만 동적 로드

// ── 타입 ─────────────────────────────────────────────────
export type AspectRatio = '1:1' | '4:5' | '9:16';

export interface SlideElement {
  id: string;
  type: 'headline' | 'body' | 'badge' | 'logo';
  content: string;
  style: {
    fontSize: number;
    fontWeight: number;
    color: string;
    textAlign: 'left' | 'center' | 'right';
    top: string;
    left: string;
  };
}

export interface Slide {
  id: string;
  position: number;
  headline: string;
  body: string;
  bg_image_url: string;
  pexels_keyword: string;
  overlay_style: 'dark' | 'light' | 'none';
  elements: SlideElement[];
  // ── 디자인 템플릿 시스템 (옵셔널 — V1 슬라이드는 없을 수 있음) ─────
  template_id?: string;          // 'dark_cinematic' | 'clean_white' | 'bold_gradient' | 'magazine' | 'luxury_gold'
  role?: string;                 // 'hook' | 'benefit' | 'detail' | 'tourist_spot' | 'inclusion' | 'cta'
  badge?: string | null;         // 옵셔널 배지 ("핵심", "TIP" 등)
  brief_section_position?: number;
}

export const ASPECT_RATIOS: Record<AspectRatio, { w: number; h: number; label: string }> = {
  '1:1':  { w: 540, h: 540, label: '정사각 (피드)' },
  '4:5':  { w: 540, h: 675, label: '세로 4:5 (피드)' },
  '9:16': { w: 540, h: 960, label: '세로 9:16 (릴스/스토리)' },
};

// ── 기본 슬라이드 팩토리 ─────────────────────────────────
function createDefaultSlide(position: number): Slide {
  return {
    id: `slide-${Date.now()}-${position}`,
    position,
    headline: '제목을 입력하세요',
    body: '본문 내용을 입력하세요',
    bg_image_url: '',
    pexels_keyword: '',
    overlay_style: 'dark',
    elements: [],
  };
}

// ── 훅 ──────────────────────────────────────────────────
export function useCardNewsEditor() {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [cardNewsId, setCardNewsId] = useState<string | null>(null);
  const [cardNewsTitle, setCardNewsTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pexelsResults, setPexelsResults] = useState<{ src: { large: string; medium: string }; alt: string }[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);

  // DB에서 기존 카드뉴스 로드
  const loadCardNews = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/card-news/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      const cn = data.card_news || data.cardNews; // Fallback 지원
      if (!cn) return;

      setCardNewsId(cn.id);
      setCardNewsTitle(cn.title || '');
      setSlides(
        (cn.slides || []).map((s: Partial<Slide>, i: number) => ({
          id: s.id || `slide-${i}`,
          position: s.position ?? i,
          headline: s.headline || '',
          body: s.body || '',
          bg_image_url: s.bg_image_url || '',
          pexels_keyword: s.pexels_keyword || '',
          overlay_style: s.overlay_style || 'dark',
          elements: s.elements || [],
        }))
      );
      setActiveSlideIndex(0);
    } catch (err) {
      console.error('카드뉴스 로드 실패:', err);
    }
  }, []);

  // 슬라이드 CRUD
  const updateSlide = useCallback((index: number, updates: Partial<Slide>) => {
    setSlides(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  }, []);

  const addSlide = useCallback(() => {
    setSlides(prev => {
      const newSlide = createDefaultSlide(prev.length);
      return [...prev, newSlide];
    });
    setActiveSlideIndex(slides.length);
  }, [slides.length]);

  const removeSlide = useCallback((index: number) => {
    setSlides(prev => {
      const next = prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i }));
      return next;
    });
    setActiveSlideIndex(prev => Math.max(0, Math.min(prev, slides.length - 2)));
  }, [slides.length]);

  const reorderSlides = useCallback((from: number, to: number) => {
    setSlides(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return arr.map((s, i) => ({ ...s, position: i }));
    });
    setActiveSlideIndex(to);
  }, []);

  // Pexels 이미지 검색
  const searchPexels = useCallback(async (keyword: string) => {
    if (!keyword.trim()) return;
    setPexelsLoading(true);
    try {
      const res = await fetch(`/api/card-news/pexels?q=${encodeURIComponent(keyword)}`);
      if (res.ok) {
        const data = await res.json();
        setPexelsResults(data.photos || []);
      }
    } catch { /* 무시 */ } finally {
      setPexelsLoading(false);
    }
  }, []);

  const swapBackground = useCallback((slideIndex: number, imageUrl: string) => {
    updateSlide(slideIndex, { bg_image_url: imageUrl });
  }, [updateSlide]);

  // DB 저장
  const saveToDb = useCallback(async () => {
    if (!cardNewsId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/card-news/${cardNewsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: cardNewsTitle, slides }),
      });
      if (!res.ok) throw new Error('저장 실패');
      return true;
    } catch (err) {
      console.error('저장 실패:', err);
      return false;
    } finally {
      setSaving(false);
    }
  }, [cardNewsId, slides, cardNewsTitle]);

  // 전체 슬라이드 내보내기 (JPG/ZIP)
  const exportAll = useCallback(async () => {
    setExporting(true);
    try {
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 300));

      const nodes = document.querySelectorAll<HTMLElement>('.card-news-export-slide');
      if (nodes.length === 0) { setExporting(false); return; }

      const name = cardNewsTitle || '카드뉴스';

      const { toJpeg } = await import('html-to-image');
      if (nodes.length === 1) {
        const url = await toJpeg(nodes[0], { quality: 0.95, pixelRatio: 3, backgroundColor: '#ffffff' });
        const a = document.createElement('a');
        a.download = `${name}_1.jpg`;
        a.href = url;
        a.click();
      } else {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        for (let i = 0; i < nodes.length; i++) {
          const url = await toJpeg(nodes[i], { quality: 0.95, pixelRatio: 3, backgroundColor: '#ffffff' });
          zip.file(`${name}_${i + 1}.jpg`, url.split(',')[1], { base64: true });
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.download = `${name}_${nodes.length}장.zip`;
        a.href = URL.createObjectURL(blob);
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (err) {
      console.error('내보내기 실패:', err);
    } finally {
      setExporting(false);
    }
  }, [cardNewsTitle]);

  return {
    slides, activeSlideIndex, aspectRatio, cardNewsId, cardNewsTitle, saving, exporting,
    pexelsResults, pexelsLoading,
    setActiveSlideIndex, setAspectRatio, setCardNewsTitle,
    loadCardNews, updateSlide, addSlide, removeSlide, reorderSlides,
    searchPexels, swapBackground, saveToDb, exportAll,
  };
}
