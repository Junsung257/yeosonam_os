'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
// html-to-image: 내보내기 시점에만 동적 로드
import {
  ANGLE_PRESETS, CHANNEL_PRESETS, TEMPLATE_PRESETS,
  generateCardSlides, generateBlogPost, generateAdCopy, generateTrackingId, generateBlogSeo,
  type AngleType, type Channel, type ImageRatio, type TemplateId, type Slide, type SlideElement, type ProductData,
} from '@/lib/content-generator';

// ── 타입 ─────────────────────────────────────────────────

interface Package {
  id: string; title: string; destination?: string; duration?: number; price?: number; status: string;
  price_tiers?: { adult_price?: number; period_label?: string }[];
  inclusions?: string[]; excludes?: string[]; product_type?: string;
  airline?: string; departure_airport?: string; product_highlights?: string[];
  itinerary?: string[]; optional_tours?: { name: string; price_usd?: number }[];
}

interface CreativeSet {
  angle: AngleType;
  channel: Channel;
  slides: Slide[];
  blogHtml?: string;
  adCopy?: { headlines: string[]; descriptions: string[] };
  trackingId: string;
  // 블로그 SEO 필드
  slug?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImageUrl?: string;
}

const FONTS = ['Pretendard', 'Noto Sans KR', 'NanumSquare', 'Gothic A1'];
const PALETTE = ['#ffffff','#000000','#1a1a2e','#001f3f','#005d90','#059669','#d97706','#ef4444','#8b5cf6','#ec4899','#0ea5e9','#f59e0b'];

const RATIO_SIZE: Record<ImageRatio, { w: number; h: number; label: string }> = {
  '1:1': { w: 1080, h: 1080, label: '1:1 정사각형' },
  '4:5': { w: 1080, h: 1350, label: '4:5 인스타' },
  '9:16': { w: 1080, h: 1920, label: '9:16 릴스/숏폼' },
  '16:9': { w: 1920, h: 1080, label: '16:9 가로형' },
};

export default function ContentHubPage() {
  const router = useRouter();
  // ── Step 관리 ──────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // ── Step 1: 설정 ──────────────────────────────────────
  const [packages, setPackages] = useState<Package[]>([]);
  const [selectedPkgId, setSelectedPkgId] = useState('');
  const [selectedAngles, setSelectedAngles] = useState<Set<AngleType>>(new Set(['emotional', 'value']));
  const [selectedChannels, setSelectedChannels] = useState<Set<Channel>>(new Set(['instagram_card']));
  const [ratio, setRatio] = useState<ImageRatio>('1:1');
  const [slideCount, setSlideCount] = useState(6);
  const [tone, setTone] = useState('professional');
  const [extraPrompt, setExtraPrompt] = useState('');
  const [templateId, setTemplateId] = useState<TemplateId>('dark_cinematic');
  const [generating, setGenerating] = useState(false);

  // ── Step 2: 편집 ──────────────────────────────────────
  const [creativeSets, setCreativeSets] = useState<CreativeSet[]>([]);
  const [activeSetIdx, setActiveSetIdx] = useState(0);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [activeElementIdx, setActiveElementIdx] = useState<number | null>(null);

  // ── Step 3: 발행 ──────────────────────────────────────
  const [publishing, setPublishing] = useState(false);

  // ── 토스트 ─────────────────────────────────────────────
  const [toast, setToast] = useState('');
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // 슬라이드 캡처 ref
  const slideCanvasRef = useRef<HTMLDivElement>(null);

  // 패키지 로드
  useEffect(() => {
    fetch('/api/packages?limit=200')
      .then(r => r.json())
      .then(d => setPackages((d.data ?? d.packages ?? []).filter((p: Package) =>
        p.destination && ['approved', 'active', 'pending', 'pending_review', 'draft'].includes(p.status)
      )))
      .catch(() => {});
  }, []);

  const selectedPkg = packages.find(p => p.id === selectedPkgId);
  const activeSet = creativeSets[activeSetIdx];
  const activeSlide = activeSet?.slides[activeSlideIdx];
  const activeElement = activeElementIdx !== null ? activeSlide?.elements[activeElementIdx] : null;

  // ── Step 1 → Step 2: AI 생성 ──────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!selectedPkg) return;
    setGenerating(true);

    try {
      const product: ProductData = {
        id: selectedPkg.id, title: selectedPkg.title,
        destination: selectedPkg.destination, duration: selectedPkg.duration,
        price: selectedPkg.price, price_tiers: selectedPkg.price_tiers,
        inclusions: selectedPkg.inclusions, excludes: selectedPkg.excludes,
        product_type: selectedPkg.product_type, airline: selectedPkg.airline,
        departure_airport: selectedPkg.departure_airport,
        product_highlights: selectedPkg.product_highlights,
        itinerary: selectedPkg.itinerary, optional_tours: selectedPkg.optional_tours,
      };

      const sets: CreativeSet[] = [];

      for (const angle of selectedAngles) {
        for (const channel of selectedChannels) {
          const trackingId = generateTrackingId(product.destination || '');

          if (channel === 'instagram_card') {
            // AI 엔진(Gemini)으로 카드뉴스 생성 후 전용 에디터로 이동
            try {
              const res = await fetch('/api/card-news', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package_id: selectedPkg.id, slide_count: slideCount, ratio }),
              });
              const cardData = await res.json();
              if (cardData.card_news?.id) {
                showToast('카드뉴스 생성 완료! 에디터로 이동합니다.');
                router.push(`/admin/marketing/card-news/${cardData.card_news.id}`);
                return;
              }
            } catch (e) {
              console.warn('[Content Hub] 카드뉴스 AI 생성 실패, 로컬 생성으로 대체:', e);
            }
            // AI 실패 시 기존 로컬 생성으로 fallback
            const slides = await generateCardSlides(product, { angle, channel, ratio, slideCount, tone, extraPrompt, templateId });
            sets.push({ angle, channel, slides, trackingId });
          } else if (channel === 'instagram_reel') {
            const slides = await generateCardSlides(product, { angle, channel, ratio, slideCount, tone, extraPrompt, templateId });
            sets.push({ angle, channel, slides, trackingId });
          } else if (channel === 'naver_blog') {
            const blogHtml = generateBlogPost(product, angle);
            const seo = generateBlogSeo(product, angle);
            sets.push({
              angle, channel, slides: [], blogHtml, trackingId,
              slug: seo.slug,
              seoTitle: seo.seoTitle,
              seoDescription: seo.seoDescription,
            });
          } else if (channel === 'google_search') {
            const adCopy = generateAdCopy(product, angle);
            sets.push({ angle, channel, slides: [], adCopy, trackingId });
          } else {
            const slides = await generateCardSlides(product, { angle, channel, ratio, slideCount, tone, extraPrompt, templateId });
            sets.push({ angle, channel, slides, trackingId });
          }
        }
      }

      setCreativeSets(sets);
      setActiveSetIdx(0);
      setActiveSlideIdx(0);
      setActiveElementIdx(null);
      setStep(2);
      showToast(`${sets.length}개 소재 생성 완료`);
    } catch (err) {
      showToast('생성 실패: ' + (err instanceof Error ? err.message : '오류'));
    } finally {
      setGenerating(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/id-trigger-only intentional
  }, [selectedPkg, selectedAngles, selectedChannels, ratio, slideCount, tone, extraPrompt]);

  // ── 슬라이드 요소 수정 ─────────────────────────────────
  const updateElement = useCallback((field: string, value: unknown) => {
    if (activeElementIdx === null) return;
    setCreativeSets(prev => prev.map((set, si) => {
      if (si !== activeSetIdx) return set;
      return {
        ...set,
        slides: set.slides.map((slide, sli) => {
          if (sli !== activeSlideIdx) return slide;
          return {
            ...slide,
            elements: slide.elements.map((el, eli) => {
              if (eli !== activeElementIdx) return el;
              return { ...el, [field]: value };
            }),
          };
        }),
      };
    }));
  }, [activeSetIdx, activeSlideIdx, activeElementIdx]);

  // ── 슬라이드 배경 수정 ─────────────────────────────────
  const updateSlideBg = useCallback((field: string, value: unknown) => {
    setCreativeSets(prev => prev.map((set, si) => {
      if (si !== activeSetIdx) return set;
      return {
        ...set,
        slides: set.slides.map((slide, sli) => {
          if (sli !== activeSlideIdx) return slide;
          return { ...slide, [field]: value };
        }),
      };
    }));
  }, [activeSetIdx, activeSlideIdx]);

  // ── ZIP 다운로드 ───────────────────────────────────────
  const handleDownloadZip = useCallback(async () => {
    if (!activeSet || !slideCanvasRef.current) return;
    setPublishing(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      for (let i = 0; i < activeSet.slides.length; i++) {
        setActiveSlideIdx(i);
        await new Promise(r => setTimeout(r, 200));
        if (!slideCanvasRef.current) continue;
        const { toJpeg } = await import('html-to-image');
        const dataUrl = await toJpeg(slideCanvasRef.current, { quality: 0.95, pixelRatio: 3 });
        const base64 = dataUrl.split(',')[1];
        zip.file(`slide_${i + 1}.jpg`, base64, { base64: true });
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedPkg?.title || 'content'}_${activeSet.angle}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('ZIP 다운로드 완료');
    } catch { showToast('다운로드 실패'); }
    finally { setPublishing(false); }
  }, [activeSet, selectedPkg]);

  // ── 블로그 복사 ────────────────────────────────────────
  const handleCopyBlog = useCallback(() => {
    if (!activeSet?.blogHtml) return;
    navigator.clipboard.writeText(activeSet.blogHtml);
    showToast('블로그 텍스트 복사됨');
  }, [activeSet]);

  // ── 블로그 공개 발행 ──────────────────────────────────
  const [blogPublishing, setBlogPublishing] = useState(false);
  const handlePublishBlog = useCallback(async (setIdx: number) => {
    const set = creativeSets[setIdx];
    if (!set || set.channel !== 'naver_blog') return;
    if (!set.slug || !set.seoTitle) {
      showToast('슬러그와 SEO 제목은 필수입니다');
      return;
    }
    setBlogPublishing(true);
    try {
      // 1. content_creatives에 저장
      const res = await fetch('/api/content-hub/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedPkgId,
          angle: set.angle,
          channel: 'naver_blog',
          ratio: '16:9',
          slideCount: 0,
          tone,
          blog_html: set.blogHtml,
          slug: set.slug,
          seo_title: set.seoTitle,
          seo_description: set.seoDescription,
          og_image_url: set.ogImageUrl,
          tracking_id: set.trackingId,
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || '저장 실패');
      const creativeId = resData.creative?.id;
      if (!creativeId) throw new Error('creative ID를 받지 못했습니다');

      // 2. published 상태로 변경
      const pubRes = await fetch('/api/content-hub/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creative_id: creativeId, action: 'publish' }),
      });
      const pubData = await pubRes.json();
      if (!pubRes.ok) throw new Error(pubData.error || '발행 상태 변경 실패');

      showToast(`블로그 발행 완료! /blog/${set.slug}`);
    } catch (err) {
      showToast('발행 실패: ' + (err instanceof Error ? err.message : '오류'));
    } finally {
      setBlogPublishing(false);
    }
  }, [creativeSets, selectedPkgId, tone]);

  // ── 렌더링 ─────────────────────────────────────────────

  const rSize = RATIO_SIZE[ratio];
  const scale = Math.min(500 / rSize.w, 500 / rSize.h);

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[16px] font-semibold text-slate-800">콘텐츠 허브</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">상품 선택 한 번으로 모든 채널 광고소재 생성</p>
        </div>
        {/* 스텝 인디케이터 */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold transition ${
                step >= s ? 'bg-[#001f3f] text-white' : 'bg-slate-200 text-slate-400'
              }`}>{s}</div>
              <span className="text-[11px] text-slate-500 hidden sm:inline">
                {s === 1 ? '설정' : s === 2 ? '편집' : '발행'}
              </span>
              {s < 3 && <div className={`w-8 h-0.5 ${step > s ? 'bg-[#001f3f]' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════════ Step 1: 설정 ═══════════════ */}
      {step === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 좌측: 상품 + 앵글 */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-2">상품 선택</label>
              <select value={selectedPkgId} onChange={e => setSelectedPkgId(e.target.value)}
                className="w-full border border-slate-200 rounded px-3 py-2 text-[13px] focus:ring-1 focus:ring-[#005d90]">
                <option value="">상품 선택...</option>
                {packages.map(p => (
                  <option key={p.id} value={p.id}>{p.title} ({p.destination})</option>
                ))}
              </select>
              {selectedPkg && (
                <div className="mt-3 p-3 bg-slate-50 rounded text-[12px] text-slate-600 space-y-1">
                  <p><span className="font-medium text-slate-700">목적지:</span> {selectedPkg.destination}</p>
                  <p><span className="font-medium text-slate-700">기간:</span> {selectedPkg.duration}일</p>
                  <p><span className="font-medium text-slate-700">가격:</span> {(selectedPkg.price || 0).toLocaleString()}원~</p>
                  <p><span className="font-medium text-slate-700">유형:</span> {selectedPkg.product_type || '-'}</p>
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-2">앵글 선택 (다중)</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(ANGLE_PRESETS) as [AngleType, typeof ANGLE_PRESETS[AngleType]][]).map(([key, preset]) => (
                  <button key={key} onClick={() => {
                    const next = new Set(selectedAngles);
                    next.has(key) ? next.delete(key) : next.add(key);
                    setSelectedAngles(next);
                  }} className={`px-3 py-2 rounded border text-[12px] text-left transition ${
                    selectedAngles.has(key) ? 'border-[#001f3f] bg-blue-50 text-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}>
                    <span className="font-semibold">{preset.label}</span>
                    <span className="block text-[10px] text-slate-400 mt-0.5">{preset.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 우측: 채널 + 옵션 */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-2">채널 선택</label>
              <div className="space-y-2">
                {(Object.entries(CHANNEL_PRESETS) as [Channel, typeof CHANNEL_PRESETS[Channel]][]).map(([key, preset]) => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedChannels.has(key)}
                      onChange={() => {
                        const next = new Set(selectedChannels);
                        next.has(key) ? next.delete(key) : next.add(key);
                        setSelectedChannels(next);
                      }}
                      className="w-4 h-4 rounded border-slate-300 text-[#001f3f] focus:ring-[#005d90]" />
                    <span className="text-[13px] text-slate-700">{preset.label}</span>
                    <span className="text-[10px] text-slate-400">{preset.description}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 디자인 템플릿 선택 */}
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-2">디자인 템플릿</label>
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {TEMPLATE_PRESETS.map(t => (
                  <button key={t.id} onClick={() => setTemplateId(t.id)}
                    className={`p-2.5 rounded border text-left transition ${
                      templateId === t.id ? 'border-[#001f3f] bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}>
                    {/* 미니 프리뷰 */}
                    <div className="w-full h-12 rounded mb-1.5 flex items-center justify-center text-[10px] font-bold"
                      style={{
                        background: t.coverStyle.bgOverlay || t.coverStyle.bgColor,
                        backgroundColor: t.coverStyle.bgColor,
                        color: t.coverStyle.headlineColor,
                      }}>
                      {t.name}
                    </div>
                    <p className="text-[11px] font-medium text-slate-700">{t.name}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">{t.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">이미지 비율</label>
                <div className="flex gap-2">
                  {(Object.entries(RATIO_SIZE) as [ImageRatio, typeof RATIO_SIZE[ImageRatio]][]).map(([key, v]) => (
                    <button key={key} onClick={() => setRatio(key)}
                      className={`px-3 py-1.5 rounded text-[12px] transition ${ratio === key ? 'bg-[#001f3f] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">
                  슬라이드 개수: <span className="text-[#001f3f] font-bold">{slideCount}장</span>
                </label>
                <input type="range" min={3} max={10} value={slideCount} onChange={e => setSlideCount(parseInt(e.target.value))}
                  className="w-full accent-[#001f3f]" />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">톤</label>
                <select value={tone} onChange={e => setTone(e.target.value)}
                  className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]">
                  <option value="professional">전문가</option>
                  <option value="casual">캐주얼</option>
                  <option value="emotional">감성적</option>
                  <option value="humorous">유머러스</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 uppercase mb-1">추가 지시사항</label>
                <textarea value={extraPrompt} onChange={e => setExtraPrompt(e.target.value)}
                  placeholder="AI에게 추가로 지시할 내용... (예: 5성급 호텔 강조)"
                  className="w-full border border-slate-200 rounded px-3 py-2 text-[12px] h-16 resize-none" />
              </div>
            </div>

            <button onClick={handleGenerate} disabled={!selectedPkgId || selectedAngles.size === 0 || generating}
              className="w-full py-3 bg-[#001f3f] text-white text-[14px] font-semibold rounded-lg hover:bg-blue-900 disabled:bg-slate-300 transition">
              {generating ? 'AI 생성 중...' : `${selectedAngles.size * selectedChannels.size}개 소재 생성`}
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ Step 2: 편집 ═══════════════ */}
      {step === 2 && activeSet && (
        <div className="space-y-3">
          {/* 앵글/채널 탭 */}
          <div className="flex gap-1 flex-wrap">
            {creativeSets.map((set, i) => (
              <button key={i} onClick={() => { setActiveSetIdx(i); setActiveSlideIdx(0); setActiveElementIdx(null); }}
                className={`px-3 py-1.5 rounded text-[12px] font-medium transition ${
                  i === activeSetIdx ? 'bg-[#001f3f] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}>
                {ANGLE_PRESETS[set.angle].label} · {CHANNEL_PRESETS[set.channel].label}
              </button>
            ))}
          </div>

          {/* 카드뉴스 편집 */}
          {(activeSet.channel === 'instagram_card' || activeSet.channel === 'instagram_reel' || activeSet.channel === 'youtube_short' || activeSet.channel === 'kakao') && (
            <div className="flex gap-4">
              {/* 좌측: 캔버스 */}
              <div className="flex-1 space-y-3">
                {/* 슬라이드 썸네일 */}
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {activeSet.slides.map((slide, i) => (
                    <button key={slide.id} onClick={() => { setActiveSlideIdx(i); setActiveElementIdx(null); }}
                      className={`flex-shrink-0 w-14 h-14 rounded border-2 text-[11px] font-bold flex items-center justify-center transition ${
                        i === activeSlideIdx ? 'border-[#001f3f] bg-blue-50 text-[#001f3f]' : 'border-slate-200 text-slate-400 hover:border-slate-300'
                      }`}>{i + 1}</button>
                  ))}
                  <button onClick={() => {
                    const newSlide: Slide = {
                      id: crypto.randomUUID(), bgColor: '#1a1a2e', bgOpacity: 70, bgOverlay: '',
                      elements: [{ id: crypto.randomUUID(), type: 'text', text: '새 텍스트', fontFamily: 'Pretendard',
                        fontSize: 32, fontWeight: 'bold', fontStyle: 'normal', textDecoration: 'none',
                        color: '#ffffff', textAlign: 'center', x: 10, y: 40, width: 80, height: 20 }],
                    };
                    setCreativeSets(prev => prev.map((s, i) => i === activeSetIdx ? { ...s, slides: [...s.slides, newSlide] } : s));
                  }} className="flex-shrink-0 w-14 h-14 rounded border-2 border-dashed border-slate-300 text-slate-400 text-[18px] flex items-center justify-center hover:bg-slate-50">+</button>
                </div>

                {/* 캔버스 */}
                {activeSlide && (
                  <div className="bg-slate-100 rounded-lg p-4 flex items-center justify-center overflow-hidden">
                    <div ref={slideCanvasRef}
                      style={{
                        width: rSize.w, height: rSize.h,
                        transform: `scale(${scale})`, transformOrigin: 'top left',
                        position: 'relative', overflow: 'hidden', borderRadius: 4,
                        background: activeSlide.bgImage
                          ? `url(${activeSlide.bgImage}) center/cover`
                          : activeSlide.bgColor,
                      }}
                      className="flex-shrink-0">
                      {/* 오버레이 */}
                      {activeSlide.bgImage && (
                        <div style={{
                          position: 'absolute', inset: 0,
                          background: activeSlide.bgOverlay || 'linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.1))',
                          opacity: (activeSlide.bgOpacity || 70) / 100,
                        }} />
                      )}
                      {/* 요소들 */}
                      {activeSlide.elements.map((el, elIdx) => (
                        <div key={el.id}
                          onClick={() => setActiveElementIdx(elIdx)}
                          style={{
                            position: 'absolute',
                            left: `${el.x}%`, top: `${el.y}%`,
                            width: `${el.width}%`, height: `${el.height}%`,
                            cursor: 'pointer',
                            outline: activeElementIdx === elIdx ? '3px solid #005d90' : 'none',
                            outlineOffset: 2,
                          }}>
                          {el.type === 'text' && (
                            <div
                              contentEditable suppressContentEditableWarning
                              onBlur={e => {
                                const text = e.currentTarget.textContent || '';
                                setActiveElementIdx(elIdx);
                                updateElement('text', text);
                              }}
                              style={{
                                fontFamily: el.fontFamily || 'Pretendard',
                                fontSize: el.fontSize || 32,
                                fontWeight: el.fontWeight || 'normal',
                                fontStyle: el.fontStyle || 'normal',
                                textDecoration: el.textDecoration || 'none',
                                color: el.color || '#ffffff',
                                textAlign: (el.textAlign || 'center') as 'left' | 'center' | 'right',
                                backgroundColor: el.bgColor || 'transparent',
                                borderRadius: el.bgColor ? 8 : 0,
                                padding: el.bgColor ? '4px 12px' : 0,
                                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                width: '100%', height: '100%',
                                display: 'flex', alignItems: 'center', justifyContent:
                                  el.textAlign === 'left' ? 'flex-start' : el.textAlign === 'right' ? 'flex-end' : 'center',
                              }}
                              className="outline-none focus:bg-white/10">
                              {el.text}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 우측: 편집 패널 */}
              <div className="w-72 bg-white border border-slate-200 rounded-lg p-4 space-y-4 flex-shrink-0 overflow-y-auto max-h-[calc(100vh-200px)]">
                {activeElement && activeElement.type === 'text' ? (
                  <>
                    <p className="text-[11px] font-semibold text-slate-500 uppercase">텍스트 편집</p>

                    {/* 폰트 */}
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">폰트</label>
                      <select value={activeElement.fontFamily || 'Pretendard'} onChange={e => updateElement('fontFamily', e.target.value)}
                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-[12px]">
                        {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>

                    {/* 크기 */}
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">
                        크기 <span className="text-[#001f3f] font-bold">{activeElement.fontSize || 32}px</span>
                      </label>
                      <input type="range" min={12} max={96} value={activeElement.fontSize || 32}
                        onChange={e => updateElement('fontSize', parseInt(e.target.value))}
                        className="w-full accent-[#001f3f]" />
                    </div>

                    {/* 스타일 토글 */}
                    <div className="flex gap-1">
                      {[
                        { key: 'fontWeight', active: activeElement.fontWeight === 'bold', on: 'bold', off: 'normal', label: 'B' },
                        { key: 'fontStyle', active: activeElement.fontStyle === 'italic', on: 'italic', off: 'normal', label: 'I' },
                        { key: 'textDecoration', active: activeElement.textDecoration === 'underline', on: 'underline', off: 'none', label: 'U' },
                        { key: 'textDecoration', active: activeElement.textDecoration === 'line-through', on: 'line-through', off: 'none', label: 'S' },
                      ].map((btn, i) => (
                        <button key={i} onClick={() => updateElement(btn.key, btn.active ? btn.off : btn.on)}
                          className={`w-8 h-8 rounded border text-[13px] font-bold transition ${
                            btn.active ? 'bg-[#001f3f] text-white border-[#001f3f]' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                          }`}
                          style={{ fontStyle: btn.label === 'I' ? 'italic' : 'normal', textDecoration: btn.label === 'U' ? 'underline' : btn.label === 'S' ? 'line-through' : 'none' }}>
                          {btn.label}
                        </button>
                      ))}
                    </div>

                    {/* 정렬 */}
                    <div className="flex gap-1">
                      {(['left', 'center', 'right'] as const).map(align => (
                        <button key={align} onClick={() => updateElement('textAlign', align)}
                          className={`flex-1 py-1.5 rounded border text-[11px] transition ${
                            activeElement.textAlign === align ? 'bg-[#001f3f] text-white border-[#001f3f]' : 'bg-white text-slate-500 border-slate-200'
                          }`}>
                          {align === 'left' ? '좌' : align === 'center' ? '중' : '우'}
                        </button>
                      ))}
                    </div>

                    {/* 글자 색상 */}
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">글자 색상</label>
                      <div className="flex flex-wrap gap-1.5">
                        {PALETTE.map(c => (
                          <button key={c} onClick={() => updateElement('color', c)}
                            className={`w-6 h-6 rounded-full border-2 transition ${activeElement.color === c ? 'border-[#001f3f] scale-110' : 'border-slate-200'}`}
                            style={{ backgroundColor: c }} />
                        ))}
                        <input type="color" value={activeElement.color || '#ffffff'}
                          onChange={e => updateElement('color', e.target.value)}
                          className="w-6 h-6 rounded cursor-pointer" />
                      </div>
                    </div>

                    {/* 배경 색상 (텍스트 배경) */}
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">텍스트 배경</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={activeElement.bgColor || '#000000'}
                          onChange={e => updateElement('bgColor', e.target.value)}
                          className="w-8 h-8 rounded cursor-pointer" />
                        <button onClick={() => updateElement('bgColor', undefined)}
                          className="text-[11px] text-slate-400 hover:text-slate-600">투명</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] font-semibold text-slate-500 uppercase">슬라이드 배경</p>

                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">배경색</label>
                      <input type="color" value={activeSlide?.bgColor || '#1a1a2e'}
                        onChange={e => updateSlideBg('bgColor', e.target.value)}
                        className="w-10 h-10 rounded cursor-pointer" />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">
                        오버레이 투명도: {activeSlide?.bgOpacity ?? 70}%
                      </label>
                      <input type="range" min={0} max={100} value={activeSlide?.bgOpacity ?? 70}
                        onChange={e => updateSlideBg('bgOpacity', parseInt(e.target.value))}
                        className="w-full accent-[#001f3f]" />
                    </div>

                    <p className="text-[10px] text-slate-400 mt-4">요소를 클릭하면 편집할 수 있습니다</p>
                  </>
                )}

                {/* 슬라이드 삭제 */}
                {activeSet.slides.length > 1 && (
                  <button onClick={() => {
                    setCreativeSets(prev => prev.map((s, i) => i === activeSetIdx
                      ? { ...s, slides: s.slides.filter((_, si) => si !== activeSlideIdx) }
                      : s));
                    setActiveSlideIdx(Math.max(0, activeSlideIdx - 1));
                    setActiveElementIdx(null);
                  }} className="w-full py-1.5 border border-red-200 text-red-500 text-[11px] rounded hover:bg-red-50 transition">
                    이 슬라이드 삭제
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 블로그 편집 */}
          {activeSet.channel === 'naver_blog' && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <p className="text-[12px] font-semibold text-slate-700 mb-2">네이버 블로그 포스팅</p>
                <textarea
                  value={activeSet.blogHtml || ''}
                  onChange={e => setCreativeSets(prev => prev.map((s, i) => i === activeSetIdx ? { ...s, blogHtml: e.target.value } : s))}
                  className="w-full h-96 border border-slate-200 rounded p-3 text-[13px] font-mono resize-y focus:outline-none focus:ring-1 focus:ring-[#005d90]"
                />
              </div>

              {/* SEO 설정 (블로그 발행용) */}
              <div className="bg-white border border-indigo-200 rounded-lg p-5 space-y-3">
                <p className="text-[12px] font-semibold text-indigo-700 mb-1">블로그 SEO 설정 (공개 발행 시 필수)</p>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">URL 슬러그 (영문/숫자/-)</label>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-400">/blog/</span>
                    <input
                      value={activeSet.slug || ''}
                      onChange={e => {
                        const slug = e.target.value.toLowerCase().replace(/[^a-z0-9가-힣-]/g, '-').replace(/-+/g, '-');
                        setCreativeSets(prev => prev.map((s, i) => i === activeSetIdx ? { ...s, slug } : s));
                      }}
                      placeholder="bangkok-5days-value-trip"
                      className="flex-1 border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">SEO 제목 (검색 결과에 표시)</label>
                  <input
                    value={activeSet.seoTitle || ''}
                    onChange={e => setCreativeSets(prev => prev.map((s, i) => i === activeSetIdx ? { ...s, seoTitle: e.target.value } : s))}
                    placeholder="방콕 5일 가성비 여행 추천 | 2026 최신 가이드"
                    maxLength={60}
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-indigo-400"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">{(activeSet.seoTitle || '').length}/60자</p>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">SEO 설명</label>
                  <textarea
                    value={activeSet.seoDescription || ''}
                    onChange={e => setCreativeSets(prev => prev.map((s, i) => i === activeSetIdx ? { ...s, seoDescription: e.target.value } : s))}
                    placeholder="방콕 5일 패키지 여행의 모든 것. 항공+호텔+관광 포함, 가성비 추천 일정..."
                    maxLength={160}
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] h-16 resize-none focus:ring-1 focus:ring-indigo-400"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">{(activeSet.seoDescription || '').length}/160자</p>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">OG 이미지 URL (선택)</label>
                  <input
                    value={activeSet.ogImageUrl || ''}
                    onChange={e => setCreativeSets(prev => prev.map((s, i) => i === activeSetIdx ? { ...s, ogImageUrl: e.target.value } : s))}
                    placeholder="https://images.pexels.com/..."
                    className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 검색광고 편집 */}
          {activeSet.channel === 'google_search' && activeSet.adCopy && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <p className="text-[12px] font-semibold text-slate-700 mb-2">구글 검색광고 카피</p>
              {activeSet.adCopy.headlines.map((h, i) => (
                <div key={i}>
                  <label className="text-[10px] text-slate-400">제목 {i + 1} (30자)</label>
                  <input value={h} onChange={e => {
                    const newHeadlines = [...(activeSet.adCopy?.headlines || [])];
                    newHeadlines[i] = e.target.value;
                    setCreativeSets(prev => prev.map((s, si) => si === activeSetIdx ? { ...s, adCopy: { ...s.adCopy!, headlines: newHeadlines } } : s));
                  }} maxLength={30} className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px]" />
                </div>
              ))}
              {activeSet.adCopy.descriptions.map((d, i) => (
                <div key={i}>
                  <label className="text-[10px] text-slate-400">설명 {i + 1} (90자)</label>
                  <textarea value={d} onChange={e => {
                    const newDescs = [...(activeSet.adCopy?.descriptions || [])];
                    newDescs[i] = e.target.value;
                    setCreativeSets(prev => prev.map((s, si) => si === activeSetIdx ? { ...s, adCopy: { ...s.adCopy!, descriptions: newDescs } } : s));
                  }} maxLength={90} className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] h-16 resize-none" />
                </div>
              ))}
            </div>
          )}

          {/* 하단 버튼 */}
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-[13px] rounded hover:bg-slate-50">이전</button>
            <div className="flex-1" />
            <button onClick={() => setStep(3)} className="px-6 py-2 bg-[#001f3f] text-white text-[13px] font-semibold rounded hover:bg-blue-900">발행 준비</button>
          </div>
        </div>
      )}

      {/* ═══════════════ Step 3: 발행 ═══════════════ */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <p className="text-[14px] font-semibold text-slate-800 mb-4">생성된 콘텐츠 ({creativeSets.length}개)</p>
            <div className="space-y-3">
              {creativeSets.map((set, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-[13px] font-medium text-slate-800">
                      {ANGLE_PRESETS[set.angle].label} · {CHANNEL_PRESETS[set.channel].label}
                    </p>
                    <p className="text-[11px] text-slate-400">추적 ID: {set.trackingId}</p>
                  </div>
                  <div className="flex gap-2">
                    {set.slides.length > 0 && (
                      <button onClick={() => { setActiveSetIdx(i); handleDownloadZip(); }} disabled={publishing}
                        className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-[11px] rounded hover:bg-slate-50">
                        {publishing ? '...' : 'ZIP'}
                      </button>
                    )}
                    {set.blogHtml && (
                      <>
                        <button onClick={() => { setActiveSetIdx(i); handleCopyBlog(); }}
                          className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-[11px] rounded hover:bg-slate-50">
                          복사
                        </button>
                        <button onClick={() => { setActiveSetIdx(i); setStep(2); }}
                          className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-[11px] rounded hover:bg-slate-50">
                          편집으로
                        </button>
                        <button onClick={() => handlePublishBlog(i)} disabled={blogPublishing || !set.slug}
                          className="px-3 py-1.5 bg-indigo-600 text-white text-[11px] rounded hover:bg-indigo-700 disabled:bg-slate-300 transition"
                          title={!set.slug ? 'SEO 설정이 필요합니다' : ''}>
                          {blogPublishing ? '발행 중...' : '블로그 발행'}
                        </button>
                      </>
                    )}
                    {set.adCopy && (
                      <button onClick={() => {
                        navigator.clipboard.writeText(
                          set.adCopy!.headlines.join('\n') + '\n---\n' + set.adCopy!.descriptions.join('\n')
                        );
                        showToast('카피 복사됨');
                      }}
                        className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-[11px] rounded hover:bg-slate-50">
                        카피 복사
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-[13px] rounded hover:bg-slate-50">편집으로</button>
            <button onClick={() => { setStep(1); setCreativeSets([]); }} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 text-[13px] rounded hover:bg-slate-50">새로 만들기</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="fixed bottom-6 right-6 z-[100] bg-[#001f3f] text-white px-5 py-3 rounded-lg text-[13px] shadow-lg">{toast}</div>}
    </div>
  );
}
