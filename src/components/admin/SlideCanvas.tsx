'use client';

import type { Slide, AspectRatio, ASPECT_RATIOS } from '@/hooks/useCardNewsEditor';

interface SlideCanvasProps {
  slide: Slide;
  ratio: (typeof ASPECT_RATIOS)[AspectRatio];
  isPreview?: boolean;
  onUpdateHeadline?: (text: string) => void;
  onUpdateBody?: (text: string) => void;
}

export default function SlideCanvas({
  slide,
  ratio,
  isPreview = false,
  onUpdateHeadline,
  onUpdateBody,
}: SlideCanvasProps) {
  const scale = isPreview ? 0.25 : 1;
  const w = ratio.w * scale;
  const h = ratio.h * scale;

  const overlayClass =
    slide.overlay_style === 'dark' ? 'bg-black/50' :
    slide.overlay_style === 'light' ? 'bg-white/40' : '';

  return (
    <div
      className={`card-news-export-slide relative overflow-hidden ${isPreview ? 'rounded' : 'rounded-lg'}`}
      style={{ width: `${w}px`, height: `${h}px`, background: '#1e293b' }}
    >
      {/* 배경 이미지 */}
      {slide.bg_image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slide.bg_image_url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          crossOrigin="anonymous"
        />
      )}

      {/* 오버레이 */}
      {overlayClass && <div className={`absolute inset-0 ${overlayClass}`} />}

      {/* 텍스트 콘텐츠 */}
      <div className={`relative z-10 flex flex-col justify-between h-full ${isPreview ? 'p-2' : 'p-8'}`}>
        {/* 상단: 로고 */}
        <div>
          <span
            className={`font-bold tracking-tight uppercase ${
              slide.overlay_style === 'light' ? 'text-[#005d90]' : 'text-white/80'
            } ${isPreview ? 'text-[6px]' : 'text-[11px]'}`}
          >
            YEOSONAM
          </span>
        </div>

        {/* 중앙: 메인 텍스트 */}
        <div className="flex-1 flex flex-col justify-center">
          {!isPreview ? (
            <>
              <h2
                contentEditable
                suppressContentEditableWarning
                onBlur={e => onUpdateHeadline?.(e.currentTarget.textContent || '')}
                className={`font-bold leading-tight outline-none focus:bg-yellow-50/20 rounded ${
                  slide.overlay_style === 'light' ? 'text-[#001f3f]' : 'text-white'
                } text-2xl mb-3`}
              >
                {slide.headline}
              </h2>
              <p
                contentEditable
                suppressContentEditableWarning
                onBlur={e => onUpdateBody?.(e.currentTarget.textContent || '')}
                className={`leading-relaxed outline-none focus:bg-yellow-50/20 rounded ${
                  slide.overlay_style === 'light' ? 'text-slate-700' : 'text-white/90'
                } text-[14px]`}
              >
                {slide.body}
              </p>
            </>
          ) : (
            <>
              <p className={`font-bold leading-tight ${
                slide.overlay_style === 'light' ? 'text-[#001f3f]' : 'text-white'
              } text-[7px] mb-0.5 line-clamp-2`}>
                {slide.headline}
              </p>
              <p className={`${
                slide.overlay_style === 'light' ? 'text-slate-600' : 'text-white/80'
              } text-[5px] line-clamp-2`}>
                {slide.body}
              </p>
            </>
          )}
        </div>

        {/* 하단: 브랜딩 */}
        <div>
          <span className={`${
            slide.overlay_style === 'light' ? 'text-slate-400' : 'text-white/40'
          } ${isPreview ? 'text-[4px]' : 'text-[9px]'}`}>
            yeosonam.co.kr
          </span>
        </div>
      </div>
    </div>
  );
}
