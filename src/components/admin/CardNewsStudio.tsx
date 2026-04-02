'use client';

import { useState, useCallback, useRef } from 'react';
// html-to-image, jszip: 내보내기 시점에만 동적 로드
import MetaAutoPublisher from './MetaAutoPublisher';

// ── 타입 ─────────────────────────────────────────────────
interface SlideData {
  slide_num: number;
  type?: string;
  image_hint?: string;
  hook_copy?: string;
  main_text?: string;
}

interface ConceptData {
  concept_name: string;
  target_audience?: string;
  hook_angle?: string;
  slides: SlideData[];
}

interface RenderedSlide extends SlideData {
  conceptName: string;
  bgUrl: string;
  pexelsResults: string[];
  pexelsIndex: number;
}

interface CardNewsStudioProps {
  onClose: () => void;
  initialJson?: string;
}

// ── 슬라이드 레이아웃 분기 ───────────────────────────────
function getLayoutType(type?: string): 'cover' | 'body' | 'outro' {
  if (!type) return 'body';
  const t = type.toLowerCase();
  if (t === 'hook' || t === 'cover') return 'cover';
  if (t === 'cta' || t === 'outro') return 'outro';
  return 'body';
}

// ══════════════════════════════════════════════════════════
//  메인 컴포넌트
// ══════════════════════════════════════════════════════════

export default function CardNewsStudio({ onClose, initialJson }: CardNewsStudioProps) {
  const [jsonInput, setJsonInput] = useState(initialJson || '');
  const [slides, setSlides] = useState<RenderedSlide[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [toast, setToast] = useState('');
  const captureRefs = useRef<(HTMLDivElement | null)[]>([]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // ── JSON 파싱 + Pexels 자동 매핑 ──────────────────────
  const handleParse = useCallback(async () => {
    setParsing(true);
    setParseError('');

    try {
      let concepts: ConceptData[];
      try {
        const parsed = JSON.parse(jsonInput.trim());
        concepts = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        setParseError('JSON 형식이 올바르지 않습니다. AI 출력을 그대로 붙여넣으세요.');
        setParsing(false);
        return;
      }

      // 슬라이드 평탄화
      const allSlides: RenderedSlide[] = [];
      for (const concept of concepts) {
        for (const slide of concept.slides || []) {
          allSlides.push({
            ...slide,
            conceptName: concept.concept_name || '',
            bgUrl: '',
            pexelsResults: [],
            pexelsIndex: 0,
          });
        }
      }

      if (allSlides.length === 0) {
        setParseError('슬라이드를 찾을 수 없습니다.');
        setParsing(false);
        return;
      }

      // Pexels 이미지 자동 매핑 (병렬, 타임아웃 방어)
      const withImages = await Promise.all(
        allSlides.map(async (slide) => {
          if (!slide.image_hint) return slide;
          try {
            const res = await Promise.race([
              fetch(`/api/card-news/pexels?keyword=${encodeURIComponent(slide.image_hint)}&per_page=5&orientation=square`),
              new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
            ]);
            if (res.ok) {
              const data = await res.json();
              const photos = data.photos || [];
              const urls = photos.map((p: { src_large2x?: string; src_medium?: string }) => p.src_large2x || p.src_medium || '');
              return { ...slide, bgUrl: urls[0] || '', pexelsResults: urls, pexelsIndex: 0 };
            }
          } catch { /* 타임아웃 또는 실패 → 이미지 없이 진행 */ }
          return slide;
        })
      );

      setSlides(withImages);
      setActiveIdx(0);
      showToast(`${withImages.length}장 슬라이드 렌더링 완료`);
    } catch (err) {
      setParseError('파싱 중 오류가 발생했습니다.');
    } finally {
      setParsing(false);
    }
  }, [jsonInput]);

  // ── Pexels 리롤 ────────────────────────────────────────
  const handleReroll = useCallback((idx: number) => {
    setSlides(prev => prev.map((s, i) => {
      if (i !== idx) return s;
      const nextIndex = (s.pexelsIndex + 1) % Math.max(1, s.pexelsResults.length);
      return { ...s, pexelsIndex: nextIndex, bgUrl: s.pexelsResults[nextIndex] || '' };
    }));
  }, []);

  // ── 배경 비우기 ────────────────────────────────────────
  const handleClearBg = useCallback((idx: number) => {
    setSlides(prev => prev.map((s, i) => i === idx ? { ...s, bgUrl: '' } : s));
  }, []);

  // ── 텍스트 수정 ────────────────────────────────────────
  const updateSlideText = useCallback((idx: number, field: 'hook_copy' | 'main_text', value: string) => {
    setSlides(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  }, []);

  // ── ZIP 다운로드 ───────────────────────────────────────
  const handleExportZip = useCallback(async () => {
    setExporting(true);
    try {
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 500));

      const { toJpeg } = await import('html-to-image');
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (let i = 0; i < slides.length; i++) {
        const node = captureRefs.current[i];
        if (!node) continue;
        const url = await toJpeg(node, { quality: 0.95, pixelRatio: 1, backgroundColor: '#1e293b' });
        zip.file(`카드뉴스_${i + 1}.jpg`, url.split(',')[1], { base64: true });
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.download = `카드뉴스_${slides.length}장.zip`;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
      showToast(`${slides.length}장 ZIP 다운로드 완료`);
    } catch {
      showToast('다운로드 실패');
    } finally {
      setExporting(false);
    }
  }, [slides]);

  const activeSlide = slides[activeIdx];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100">
      {/* ── 상단 툴바 ──────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition p-1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h2 className="text-[15px] font-semibold text-slate-800">카드뉴스 스튜디오</h2>
          {slides.length > 0 && (
            <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{slides.length}장</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {slides.length > 0 && (
            <>
              <button
                onClick={handleExportZip}
                disabled={exporting}
                className="px-4 py-1.5 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 disabled:bg-slate-300 transition font-medium"
              >
                {exporting ? '생성 중...' : `ZIP 다운로드`}
              </button>
              <button
                onClick={() => setMetaOpen(true)}
                className="px-4 py-1.5 bg-emerald-600 text-white text-[13px] rounded hover:bg-emerald-700 transition font-medium"
              >
                Meta 라이브
              </button>
            </>
          )}
          <button onClick={onClose} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-[13px] rounded hover:bg-slate-50 transition">
            닫기
          </button>
        </div>
      </div>

      {/* ── 메인 영역 ──────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* 좌측: JSON 입력 */}
        <div className="w-80 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
          <div className="px-3 py-2 border-b border-slate-200">
            <p className="text-[11px] font-semibold text-slate-400 uppercase">JSON 입력</p>
            <p className="text-[10px] text-slate-400 mt-0.5">AI가 출력한 JSON을 붙여넣으세요</p>
          </div>
          <textarea
            value={jsonInput}
            onChange={e => setJsonInput(e.target.value)}
            placeholder={`[\n  {\n    "concept_name": "가성비",\n    "slides": [\n      {\n        "slide_num": 1,\n        "type": "hook",\n        "image_hint": "beach sunset",\n        "hook_copy": "제목",\n        "main_text": "본문"\n      }\n    ]\n  }\n]`}
            className="flex-1 px-3 py-2 text-[11px] font-mono text-slate-700 border-none resize-none focus:ring-0 bg-slate-50"
          />
          {parseError && (
            <div className="px-3 py-2 bg-red-50 border-t border-red-200 text-[11px] text-red-600">{parseError}</div>
          )}
          <div className="px-3 py-2 border-t border-slate-200">
            <button
              onClick={handleParse}
              disabled={parsing || !jsonInput.trim()}
              className="w-full py-2 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 disabled:bg-slate-300 transition font-medium"
            >
              {parsing ? 'Pexels 이미지 매핑 중...' : '렌더링 시작'}
            </button>
          </div>
        </div>

        {/* 중앙: 메인 캔버스 프리뷰 */}
        <div className="flex-1 bg-slate-100 overflow-auto flex items-center justify-center p-4">
          {activeSlide ? (
            <div className="relative">
              {/* 프리뷰 (축소) */}
              <div style={{ width: '540px', height: '540px', overflow: 'hidden' }}>
                <div style={{ transform: 'scale(0.5)', transformOrigin: 'top left' }}>
                  <SlideRenderer
                    slide={activeSlide}
                    ref={(el: HTMLDivElement | null) => { captureRefs.current[activeIdx] = el; }}
                    onUpdateText={updateSlideText}
                    slideIndex={activeIdx}
                  />
                </div>
              </div>
              {/* 컨트롤 오버레이 */}
              <div className="absolute top-2 right-2 flex gap-1">
                {activeSlide.pexelsResults.length > 1 && (
                  <button
                    onClick={() => handleReroll(activeIdx)}
                    className="px-2 py-1 bg-white/90 border border-slate-200 rounded text-[11px] text-slate-600 hover:bg-white shadow-sm"
                  >
                    리롤 ({activeSlide.pexelsIndex + 1}/{activeSlide.pexelsResults.length})
                  </button>
                )}
                <button
                  onClick={() => handleClearBg(activeIdx)}
                  className="px-2 py-1 bg-white/90 border border-slate-200 rounded text-[11px] text-slate-600 hover:bg-white shadow-sm"
                >
                  배경 제거
                </button>
              </div>
              {/* 컨셉/슬라이드 번호 */}
              <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[11px] px-2 py-1 rounded">
                {activeSlide.conceptName} — {activeIdx + 1}/{slides.length}
              </div>
            </div>
          ) : (
            <div className="text-center text-slate-400">
              <p className="text-[14px] mb-1">JSON을 입력하고 렌더링을 시작하세요</p>
              <p className="text-[11px]">Phase 1에서 복사한 AI 출력을 좌측에 붙여넣으세요</p>
            </div>
          )}
        </div>

        {/* 우측: 슬라이드 목록 */}
        {slides.length > 0 && (
          <div className="w-44 bg-white border-l border-slate-200 overflow-y-auto flex-shrink-0">
            <div className="px-2 py-2 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase">
              슬라이드 목록
            </div>
            {slides.map((slide, idx) => (
              <button
                key={idx}
                onClick={() => setActiveIdx(idx)}
                className={`w-full p-1.5 border-b border-slate-100 text-left transition ${
                  idx === activeIdx ? 'bg-blue-50 border-l-2 border-l-[#005d90]' : 'hover:bg-slate-50'
                }`}
              >
                {/* 미니 프리뷰 */}
                <div
                  className="w-full aspect-square rounded overflow-hidden mb-1"
                  style={{
                    background: slide.bgUrl ? `url(${slide.bgUrl}) center/cover` : 'linear-gradient(135deg, #001f3f, #005d90)',
                  }}
                >
                  <div className="w-full h-full bg-gradient-to-t from-black/70 to-transparent flex items-end p-1">
                    <span className="text-white text-[7px] font-bold truncate">{slide.hook_copy || `슬라이드 ${idx + 1}`}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-slate-500 truncate">{slide.conceptName}</span>
                  <span className="text-[9px] text-slate-400">{idx + 1}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── 숨겨진 1080x1080 캡처 DOM ────────────────── */}
      <div className="fixed -left-[9999px] top-0" aria-hidden>
        {slides.map((slide, idx) => (
          <SlideRenderer
            key={idx}
            slide={slide}
            ref={(el: HTMLDivElement | null) => { captureRefs.current[idx] = el; }}
            onUpdateText={() => {}}
            slideIndex={idx}
          />
        ))}
      </div>

      {/* MetaAutoPublisher */}
      {metaOpen && (
        <MetaAutoPublisher
          onClose={() => setMetaOpen(false)}
          slides={slides.map(s => ({ hook_copy: s.hook_copy, main_text: s.main_text }))}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-[#001f3f] text-white px-5 py-3 rounded-lg text-[13px] shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  슬라이드 렌더러 (1080x1080)
// ══════════════════════════════════════════════════════════

import { forwardRef } from 'react';

const SlideRenderer = forwardRef<HTMLDivElement, {
  slide: RenderedSlide;
  slideIndex: number;
  onUpdateText: (idx: number, field: 'hook_copy' | 'main_text', value: string) => void;
}>(function SlideRenderer({ slide, slideIndex, onUpdateText }, ref) {
  const layout = getLayoutType(slide.type);

  return (
    <div
      ref={ref}
      className="card-news-studio-slide relative overflow-hidden"
      style={{
        width: '1080px',
        height: '1080px',
        background: slide.bgUrl ? undefined : 'linear-gradient(135deg, #001f3f, #005d90)',
        fontFamily: 'Pretendard, sans-serif',
      }}
    >
      {/* 배경 이미지 */}
      {slide.bgUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slide.bgUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          crossOrigin="anonymous"
        />
      )}

      {/* 오버레이 */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

      {/* 콘텐츠 */}
      <div className="absolute inset-0 z-10 flex flex-col p-16" style={{ color: 'white' }}>
        {/* 상단 로고 */}
        <div className="flex justify-between items-start">
          <span style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.5px', opacity: 0.7 }}>YEOSONAM</span>
          {slide.type && (
            <span style={{ fontSize: '14px', background: 'rgba(255,255,255,0.15)', padding: '4px 12px', borderRadius: '20px', fontWeight: 600 }}>
              {slide.type.toUpperCase()}
            </span>
          )}
        </div>

        {/* 메인 텍스트 — 레이아웃별 분기 */}
        {layout === 'cover' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <p
              contentEditable
              suppressContentEditableWarning
              onBlur={e => onUpdateText(slideIndex, 'hook_copy', e.currentTarget.textContent || '')}
              style={{ fontSize: '64px', fontWeight: 800, lineHeight: 1.15, marginBottom: '24px', outline: 'none' }}
            >
              {slide.hook_copy || '제목'}
            </p>
            <p
              contentEditable
              suppressContentEditableWarning
              onBlur={e => onUpdateText(slideIndex, 'main_text', e.currentTarget.textContent || '')}
              style={{ fontSize: '28px', fontWeight: 400, opacity: 0.85, lineHeight: 1.5, maxWidth: '800px', outline: 'none' }}
            >
              {slide.main_text || '본문'}
            </p>
          </div>
        )}

        {layout === 'body' && (
          <div className="flex-1 flex flex-col justify-end">
            <p
              contentEditable
              suppressContentEditableWarning
              onBlur={e => onUpdateText(slideIndex, 'hook_copy', e.currentTarget.textContent || '')}
              style={{ fontSize: '48px', fontWeight: 800, lineHeight: 1.2, marginBottom: '16px', outline: 'none' }}
            >
              {slide.hook_copy || '제목'}
            </p>
            <p
              contentEditable
              suppressContentEditableWarning
              onBlur={e => onUpdateText(slideIndex, 'main_text', e.currentTarget.textContent || '')}
              style={{ fontSize: '26px', fontWeight: 400, opacity: 0.85, lineHeight: 1.6, outline: 'none' }}
            >
              {slide.main_text || '본문'}
            </p>
          </div>
        )}

        {layout === 'outro' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <span style={{ fontSize: '56px', fontWeight: 900, letterSpacing: '-1px', marginBottom: '24px' }}>YEOSONAM</span>
            <p style={{ fontSize: '18px', opacity: 0.6, marginBottom: '40px', letterSpacing: '3px' }}>가치 있는 여행을 소개합니다</p>
            <p
              contentEditable
              suppressContentEditableWarning
              onBlur={e => onUpdateText(slideIndex, 'hook_copy', e.currentTarget.textContent || '')}
              style={{ fontSize: '40px', fontWeight: 700, lineHeight: 1.3, marginBottom: '16px', outline: 'none' }}
            >
              {slide.hook_copy || '지금 예약하기'}
            </p>
            <p
              contentEditable
              suppressContentEditableWarning
              onBlur={e => onUpdateText(slideIndex, 'main_text', e.currentTarget.textContent || '')}
              style={{ fontSize: '24px', opacity: 0.8, outline: 'none' }}
            >
              {slide.main_text || '문의: yeosonam.co.kr'}
            </p>
          </div>
        )}

        {/* 하단 브랜딩 */}
        <div className="mt-auto flex justify-between items-end">
          <span style={{ fontSize: '14px', opacity: 0.4 }}>yeosonam.co.kr</span>
          <span style={{ fontSize: '14px', opacity: 0.4 }}>{slide.slide_num || slideIndex + 1}</span>
        </div>
      </div>
    </div>
  );
});
