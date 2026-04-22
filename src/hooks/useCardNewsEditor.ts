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
    template_id: 'clean_white',
    role: position === 0 ? 'hook' : 'content',
    badge: null,
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
          template_id: s.template_id,
          role: s.role,
          badge: s.badge ?? null,
          brief_section_position: s.brief_section_position,
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

  // 전체 슬라이드 내보내기 (서버 Satori 우선, html-to-image 폴백)
  const exportAll = useCallback(async () => {
    setExporting(true);
    try {
      const name = cardNewsTitle || '카드뉴스';

      // ── 1차: V2 render-v2 (Atom 기반, 1:1 포맷) ─────
      if (cardNewsId) {
        try {
          const v2Res = await fetch('/api/card-news/render-v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card_news_id: cardNewsId, formats: ['1x1'] }),
          });
          if (v2Res.ok) {
            const v2Data = await v2Res.json() as {
              renders?: Array<{ slide_index: number; format: string; url: string | null; error?: string }>;
              error?: string;
            };
            const v2Urls = (v2Data.renders ?? [])
              .filter((r) => r.format === '1x1')
              .sort((a, b) => a.slide_index - b.slide_index)
              .map((r) => r.url);
            const v2Valid = v2Urls.filter((u): u is string => typeof u === 'string' && u.length > 0);

            // 전 슬라이드 V2 렌더 성공 → ZIP
            if (v2Valid.length > 0 && v2Valid.length === v2Urls.length) {
              if (v2Valid.length === 1) {
                const blob = await (await fetch(v2Valid[0])).blob();
                const a = document.createElement('a');
                a.download = `${name}_1.png`;
                a.href = URL.createObjectURL(blob);
                a.click();
                URL.revokeObjectURL(a.href);
              } else {
                const { default: JSZip } = await import('jszip');
                const zip = new JSZip();
                for (let i = 0; i < v2Valid.length; i++) {
                  const blob = await (await fetch(v2Valid[i])).blob();
                  zip.file(`${name}_${i + 1}.png`, blob);
                }
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const a = document.createElement('a');
                a.download = `${name}_${v2Valid.length}장.zip`;
                a.href = URL.createObjectURL(zipBlob);
                a.click();
                URL.revokeObjectURL(a.href);
              }
              console.log('[exportAll] V2 Satori 렌더 성공:', v2Valid.length, '장');
              return;
            }
            console.warn('[exportAll] V2 렌더 부분 실패, V1로 폴백');
          }
        } catch (err) {
          console.warn('[exportAll] V2 렌더 호출 실패, V1로 폴백:', err instanceof Error ? err.message : err);
        }
      }

      // ── 2차: V1 render (기존 Satori, 5 템플릿) ─────
      if (cardNewsId) {
        try {
          const res = await fetch('/api/card-news/render', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card_news_id: cardNewsId }),
          });
          if (res.ok) {
            const { urls, errors } = await res.json() as { urls: (string | null)[]; errors?: string[] };
            const validUrls = (urls || []).filter((u): u is string => typeof u === 'string' && u.length > 0);

            // 모든 슬라이드가 서버 렌더 성공한 경우만 이 경로 사용
            if (validUrls.length > 0 && validUrls.length === urls.length) {
              // 단건: 바로 다운로드
              if (validUrls.length === 1) {
                const blob = await (await fetch(validUrls[0])).blob();
                const a = document.createElement('a');
                a.download = `${name}_1.png`;
                a.href = URL.createObjectURL(blob);
                a.click();
                URL.revokeObjectURL(a.href);
              } else {
                // 다건: ZIP
                const { default: JSZip } = await import('jszip');
                const zip = new JSZip();
                for (let i = 0; i < validUrls.length; i++) {
                  const blob = await (await fetch(validUrls[i])).blob();
                  zip.file(`${name}_${i + 1}.png`, blob);
                }
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                const a = document.createElement('a');
                a.download = `${name}_${validUrls.length}장.zip`;
                a.href = URL.createObjectURL(zipBlob);
                a.click();
                URL.revokeObjectURL(a.href);
              }
              console.log('[exportAll] 서버 Satori 렌더 성공:', validUrls.length, '장');
              return;
            }
            if (errors && errors.length) {
              console.warn('[exportAll] 서버 렌더 부분 실패, 폴백 사용:', errors);
            }
          }
        } catch (err) {
          console.warn('[exportAll] 서버 렌더 호출 실패, 폴백:', err instanceof Error ? err.message : err);
        }
      }

      // ── 폴백: 클라이언트 html-to-image (서버 렌더 불가 시) ─────
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 300));

      const nodes = document.querySelectorAll<HTMLElement>('.card-news-export-slide');
      if (nodes.length === 0) return;

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
  }, [cardNewsTitle, cardNewsId]);

  return {
    slides, activeSlideIndex, aspectRatio, cardNewsId, cardNewsTitle, saving, exporting,
    pexelsResults, pexelsLoading,
    setActiveSlideIndex, setAspectRatio, setCardNewsTitle,
    loadCardNews, updateSlide, addSlide, removeSlide, reorderSlides,
    searchPexels, swapBackground, saveToDb, exportAll,
  };
}
