'use client';

import { useState } from 'react';
import { useCardNewsEditor, ASPECT_RATIOS, type AspectRatio } from '@/hooks/useCardNewsEditor';
import SlideCanvas from './SlideCanvas';

interface CardNewsEditorProps {
  cardNewsId: string;
}

export default function CardNewsEditor({ cardNewsId }: CardNewsEditorProps) {
  const {
    slides, activeSlideIndex, aspectRatio, cardNewsTitle, saving, exporting,
    pexelsResults, pexelsLoading,
    setActiveSlideIndex, setAspectRatio, setCardNewsTitle,
    loadCardNews, updateSlide, addSlide, removeSlide,
    searchPexels, swapBackground, saveToDb, exportAll,
  } = useCardNewsEditor();

  const [pexelsQuery, setPexelsQuery] = useState('');
  const [showPexels, setShowPexels] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 초기 로드
  useState(() => { loadCardNews(cardNewsId); });

  const activeSlide = slides[activeSlideIndex];
  const ratio = ASPECT_RATIOS[aspectRatio];

  const handleSave = async () => {
    const ok = await saveToDb();
    setToast(ok ? '저장 완료' : '저장 실패');
    setTimeout(() => setToast(null), 2000);
  };

  const handlePexelsSearch = () => {
    if (pexelsQuery.trim()) searchPexels(pexelsQuery);
  };

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* ── 상단 툴바 ──────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <input
            value={cardNewsTitle}
            onChange={e => setCardNewsTitle(e.target.value)}
            className="text-[16px] font-semibold text-slate-800 border-none focus:ring-0 bg-transparent w-64 placeholder:text-slate-400"
            placeholder="카드뉴스 제목"
          />
          <span className="text-[11px] text-slate-400">{slides.length}장</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 비율 선택 */}
          <div className="flex border border-slate-200 rounded overflow-hidden">
            {(Object.keys(ASPECT_RATIOS) as AspectRatio[]).map(r => (
              <button
                key={r}
                onClick={() => setAspectRatio(r)}
                className={`px-3 py-1 text-[11px] transition ${
                  aspectRatio === r ? 'bg-[#001f3f] text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-[#001f3f] text-white text-[13px] rounded hover:bg-blue-900 disabled:bg-slate-300 transition"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
          <button
            onClick={exportAll}
            disabled={exporting}
            className="px-4 py-1.5 bg-white border border-slate-300 text-slate-700 text-[13px] rounded hover:bg-slate-50 disabled:bg-slate-100 transition"
          >
            {exporting ? '생성 중...' : 'JPG 내보내기'}
          </button>
        </div>
      </div>

      {/* ── 메인 영역 ──────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* 좌측: 슬라이드 목록 */}
        <div className="w-40 bg-slate-50 border-r border-slate-200 overflow-y-auto p-2 space-y-2 flex-shrink-0">
          {slides.map((slide, idx) => (
            <button
              key={slide.id}
              onClick={() => setActiveSlideIndex(idx)}
              className={`w-full relative group ${
                idx === activeSlideIndex ? 'ring-2 ring-[#005d90] rounded' : ''
              }`}
            >
              <SlideCanvas slide={slide} ratio={ratio} isPreview />
              <span className="absolute top-1 left-1 bg-black/60 text-white text-[8px] px-1 rounded font-bold">
                {idx + 1}
              </span>
              {slides.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); removeSlide(idx); }}
                  className="absolute top-1 right-1 bg-red-500 text-white text-[8px] w-4 h-4 rounded-full opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                >
                  x
                </button>
              )}
            </button>
          ))}
          <button
            onClick={addSlide}
            className="w-full border-2 border-dashed border-slate-300 rounded py-4 text-slate-400 text-[12px] hover:border-slate-400 hover:text-slate-500 transition"
          >
            + 추가
          </button>
        </div>

        {/* 중앙: 메인 캔버스 */}
        <div className="flex-1 bg-slate-100 overflow-auto flex items-center justify-center p-8">
          {activeSlide ? (
            <SlideCanvas
              slide={activeSlide}
              ratio={ratio}
              onUpdateHeadline={text => updateSlide(activeSlideIndex, { headline: text })}
              onUpdateBody={text => updateSlide(activeSlideIndex, { body: text })}
            />
          ) : (
            <p className="text-slate-400 text-[14px]">슬라이드를 선택하세요</p>
          )}
        </div>

        {/* 우측: 속성 패널 */}
        <div className="w-64 bg-white border-l border-slate-200 overflow-y-auto p-4 space-y-5 flex-shrink-0">
          {activeSlide ? (
            <>
              {/* 오버레이 */}
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-2">오버레이</label>
                <div className="flex gap-1">
                  {(['dark', 'light', 'none'] as const).map(style => (
                    <button
                      key={style}
                      onClick={() => updateSlide(activeSlideIndex, { overlay_style: style })}
                      className={`flex-1 py-1.5 text-[11px] rounded border transition ${
                        activeSlide.overlay_style === style
                          ? 'bg-[#001f3f] text-white border-[#001f3f]'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {style === 'dark' ? '어둡게' : style === 'light' ? '밝게' : '없음'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 배경 이미지 */}
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-2">배경 이미지</label>
                {activeSlide.bg_image_url ? (
                  <div className="relative mb-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={activeSlide.bg_image_url} alt="" className="w-full h-24 object-cover rounded" />
                    <button
                      onClick={() => swapBackground(activeSlideIndex, '')}
                      className="absolute top-1 right-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded"
                    >
                      제거
                    </button>
                  </div>
                ) : (
                  <div className="w-full h-16 bg-slate-100 rounded border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 text-[11px] mb-2">
                    이미지 없음
                  </div>
                )}
                <button
                  onClick={() => setShowPexels(!showPexels)}
                  className="w-full py-1.5 text-[12px] bg-white border border-slate-200 rounded text-slate-600 hover:bg-slate-50 transition"
                >
                  {showPexels ? '닫기' : 'Pexels에서 검색'}
                </button>

                {showPexels && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-1">
                      <input
                        value={pexelsQuery}
                        onChange={e => setPexelsQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handlePexelsSearch()}
                        placeholder="검색어 (영문)"
                        className="flex-1 px-2 py-1 border border-slate-200 rounded text-[12px] focus:ring-1 focus:ring-[#005d90]"
                      />
                      <button
                        onClick={handlePexelsSearch}
                        disabled={pexelsLoading}
                        className="px-2 py-1 bg-[#001f3f] text-white text-[11px] rounded hover:bg-blue-900 disabled:bg-slate-300"
                      >
                        {pexelsLoading ? '...' : '검색'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
                      {pexelsResults.map((photo, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            swapBackground(activeSlideIndex, photo.src.large);
                            setShowPexels(false);
                          }}
                          className="overflow-hidden rounded hover:ring-2 hover:ring-[#005d90] transition"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo.src.medium} alt={photo.alt} className="w-full h-16 object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 텍스트 편집 */}
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-2">제목</label>
                <textarea
                  value={activeSlide.headline}
                  onChange={e => updateSlide(activeSlideIndex, { headline: e.target.value })}
                  rows={2}
                  className="w-full px-2 py-1.5 border border-slate-200 rounded text-[13px] focus:ring-1 focus:ring-[#005d90] resize-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-2">본문</label>
                <textarea
                  value={activeSlide.body}
                  onChange={e => updateSlide(activeSlideIndex, { body: e.target.value })}
                  rows={4}
                  className="w-full px-2 py-1.5 border border-slate-200 rounded text-[13px] focus:ring-1 focus:ring-[#005d90] resize-none"
                />
              </div>

              {/* Pexels 키워드 */}
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase block mb-2">이미지 키워드</label>
                <input
                  value={activeSlide.pexels_keyword}
                  onChange={e => updateSlide(activeSlideIndex, { pexels_keyword: e.target.value })}
                  className="w-full px-2 py-1.5 border border-slate-200 rounded text-[13px] focus:ring-1 focus:ring-[#005d90]"
                  placeholder="e.g. danang beach"
                />
              </div>
            </>
          ) : (
            <p className="text-slate-400 text-[13px] text-center py-8">슬라이드를 선택하세요</p>
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
