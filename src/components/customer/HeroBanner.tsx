'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { SafeCoverImg } from '@/components/customer/SafeRemoteImage';

export interface HeroSlide {
  image: string;
  destination: string;
  title: string;
  tagline?: string;
  minPrice?: number;
  href: string;
}

interface Props {
  slides: HeroSlide[];
  autoPlayMs?: number;
}

export default function HeroBanner({ slides, autoPlayMs = 5000 }: Props) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);

  const next = useCallback(() => {
    setCurrent(c => (c + 1) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const id = setInterval(next, autoPlayMs);
    return () => clearInterval(id);
  }, [paused, next, autoPlayMs, slides.length]);

  if (slides.length === 0) return null;

  const slide = slides[current];

  return (
    <div
      className="relative w-full aspect-[3/2] md:aspect-[16/7] overflow-hidden bg-bg-section"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* 슬라이드 이미지 */}
      {slides.map((s, i) => (
        <div
          key={i}
          className={`absolute inset-0 transition-opacity duration-700 ${i === current ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden={i !== current}
        >
          <SafeCoverImg
            src={s.image}
            alt={s.destination}
            className="absolute inset-0 h-full w-full object-cover"
            loading={i === 0 ? 'eager' : 'lazy'}
            fetchPriority={i === 0 ? 'high' : undefined}
            fallback={<div className="absolute inset-0 bg-gradient-to-br from-brand-dark to-brand" aria-hidden />}
          />
        </div>
      ))}

      {/* 그라데이션 오버레이 — 하단 타이포 가독성 + 전역 딤 */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/5 pointer-events-none" />
      {/* 텍스트 영역(하단) 추가 딤 */}
      <div
        className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-transparent to-black/45"
        aria-hidden
      />

      {/* 텍스트 + CTA */}
      <Link href={slide.href} className="absolute inset-0 flex flex-col justify-end p-6 md:p-12 pb-10 md:pb-14">
        <div>
          <p className="text-micro md:text-body font-semibold text-white/80 uppercase tracking-widest mb-2">{slide.destination}</p>
          <h2 className="text-[28px] md:text-[44px] font-extrabold text-white leading-[1.2] tracking-[-0.03em] line-clamp-2 break-keep">
            {slide.title}
          </h2>
          {slide.tagline && (
            <p className="mt-1.5 text-[14px] md:text-[16px] text-white/85 font-medium leading-snug line-clamp-1 break-keep">
              {slide.tagline}
            </p>
          )}
          {slide.minPrice && slide.minPrice > 0 && (
            <p className="mt-3 text-[14px] text-white/90 font-medium">
              최저 <span className="text-white font-extrabold text-price tabular-nums">{slide.minPrice.toLocaleString()}</span>원~
            </p>
          )}
        </div>
      </Link>

      {/* 불릿 네비게이터 */}
      {slides.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 pointer-events-none">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={e => { e.preventDefault(); setCurrent(i); }}
              className={`pointer-events-auto rounded-full transition-all ${
                i === current
                  ? 'w-5 h-1.5 bg-white'
                  : 'w-1.5 h-1.5 bg-white/50'
              }`}
              aria-label={`슬라이드 ${i + 1}`}
            />
          ))}
        </div>
      )}

      {/* 슬라이드 번호 */}
      <div className="absolute top-4 right-4 text-[11px] text-white/70 font-medium tabular-nums">
        {current + 1} / {slides.length}
      </div>
    </div>
  );
}
