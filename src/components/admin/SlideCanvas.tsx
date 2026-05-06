'use client';

import type { Slide, AspectRatio, ASPECT_RATIOS } from '@/hooks/useCardNewsEditor';
import { getTemplateComponent } from '@/components/card-news/templates';

interface SlideCanvasProps {
  slide: Slide;
  ratio: (typeof ASPECT_RATIOS)[AspectRatio];
  isPreview?: boolean;
  totalSlides?: number;
  onUpdateHeadline?: (text: string) => void;
  onUpdateBody?: (text: string) => void;
}

export default function SlideCanvas({
  slide,
  ratio,
  isPreview = false,
  totalSlides,
  onUpdateHeadline,
  onUpdateBody,
}: SlideCanvasProps) {
  // ── 신규 템플릿 시스템: slide.template_id가 있으면 해당 템플릿으로 라우팅 ─────
  const TemplateComponent = getTemplateComponent(slide.template_id);
  if (TemplateComponent) {
    const variant: 'cover' | 'content' | 'cta' =
      slide.role === 'hook' || slide.position === 1 ? 'cover'
      : slide.role === 'cta' ? 'cta'
      : 'content';

    return (
      <TemplateComponent
        headline={slide.headline}
        body={slide.body}
        bgImageUrl={slide.bg_image_url}
        badge={slide.badge}
        variant={variant}
        pageIndex={slide.position}
        totalPages={totalSlides}
        ratio={ratio}
        isPreview={isPreview}
        onUpdateHeadline={onUpdateHeadline}
        onUpdateBody={onUpdateBody}
      />
    );
  }

  // ── V1 단일 패턴 (하위 호환) ─────────────────────────────
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
                onBlur={e => onUpdateHeadline?.(e.currentTarget.innerText || '')}
                className={`font-bold leading-tight outline-none focus:bg-yellow-50/20 rounded ${
                  slide.overlay_style === 'light' ? 'text-slate-900' : 'text-white'
                } text-2xl mb-3`}
              >
                {slide.headline}
              </h2>
              <p
                contentEditable
                suppressContentEditableWarning
                onBlur={e => onUpdateBody?.(e.currentTarget.innerText || '')}
                className={`leading-relaxed outline-none focus:bg-yellow-50/20 rounded ${
                  slide.overlay_style === 'light' ? 'text-slate-700' : 'text-white/90'
                } text-admin-base`}
              >
                {slide.body}
              </p>
            </>
          ) : (
            <>
              <p className={`font-bold leading-tight ${
                slide.overlay_style === 'light' ? 'text-slate-900' : 'text-white'
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
