'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { isSafeImageSrc } from '@/lib/image-url';
import { toBlogImageDisplaySrc } from '@/lib/blog-image-proxy';

type CoverProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
  loading?: 'eager' | 'lazy';
  fetchPriority?: 'high' | 'low' | 'auto';
  fallback: ReactNode;
};

/** 풀블리드 배경용 — 로드 실패·비안전 URL 시 fallback 만 표시 */
export function SafeCoverImg({ src, alt, className, loading = 'lazy', fetchPriority, fallback }: CoverProps) {
  const displaySrc = toBlogImageDisplaySrc(src);
  const ok = typeof displaySrc === 'string' && isSafeImageSrc(displaySrc);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  if (!ok || broken) return <>{fallback}</>;
  return (
    <img
      src={displaySrc.trim()}
      alt={alt}
      className={className}
      loading={loading}
      fetchPriority={fetchPriority}
      onError={() => setBroken(true)}
    />
  );
}

type CoverNextProps = {
  src: string | null | undefined;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
  fallback: ReactNode;
};

/**
 * 풀블리드 배경용 — Next.js Image 최적화 버전.
 * Pexels / Supabase 등 next.config remotePatterns에 등록된 도메인 전용.
 * 부모 요소에 position: relative/absolute/fixed 가 있어야 함.
 */
export function SafeCoverNextImg({ src, alt, sizes, priority = false, className, fallback }: CoverNextProps) {
  const displaySrc = toBlogImageDisplaySrc(src);
  const ok = typeof displaySrc === 'string' && isSafeImageSrc(displaySrc);
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  if (!ok || broken) return <>{fallback}</>;
  return (
    <img
      src={displaySrc.trim()}
      alt={alt}
      className={`absolute inset-0 h-full w-full object-cover${className ? ` ${className}` : ''}`}
      sizes={sizes ?? '100vw'}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      onError={() => setBroken(true)}
    />
  );
}

type MagazineProps = {
  url: string | null | undefined;
  title: string;
  placeholderClassName?: string;
};

type DestinationImageFallbackProps = {
  title: string;
  destination?: string | null;
  className?: string;
  compact?: boolean;
};

export function DestinationImageFallback({ title, destination, className = '', compact = false }: DestinationImageFallbackProps) {
  const destinationLabel = destination?.trim() || title.split(/[·|/,-]/)[0]?.trim() || '여행 상품';
  const titleLabel = title.trim() || '상품 정보를 확인해 주세요';

  return (
    <div
      className={`absolute inset-0 flex h-full w-full flex-col justify-end overflow-hidden bg-gradient-to-br from-[#EAF3FF] via-white to-[#E9F8F0] p-3 text-left ${className}`}
      aria-label={`${destinationLabel} 상품 이미지 준비 중`}
      role="img"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand via-emerald-400 to-sky-400" aria-hidden />
      <div className="relative">
        <span className="mb-1 inline-flex max-w-full rounded-full bg-white/85 px-2 py-1 text-[10px] font-extrabold text-brand shadow-sm">
          <span className="truncate">{destinationLabel}</span>
        </span>
        <p className={`${compact ? 'text-[12px]' : 'text-sm'} line-clamp-2 font-extrabold leading-tight text-slate-900`}>
          {titleLabel}
        </p>
        <p className="mt-1 text-[10px] font-semibold text-slate-500">이미지 준비 중 · 조건 먼저 확인 가능</p>
      </div>
    </div>
  );
}

/** 블로그/매거진 카드 16:9 썸네일 — 임의 OG 도메인용 일반 img */
export function SafeMagazineThumb({ url, title, placeholderClassName }: MagazineProps) {
  const [hide, setHide] = useState(false);
  const displaySrc = toBlogImageDisplaySrc(url);
  const ok = typeof displaySrc === 'string' && isSafeImageSrc(displaySrc) && !hide;
  useEffect(() => {
    setHide(false);
  }, [url]);
  if (!ok) {
    return (
      <div
        className={
          placeholderClassName ||
          'relative aspect-[16/9] overflow-hidden bg-gray-100'
        }
      >
        <DestinationImageFallback title={title || '여행 준비 가이드'} destination={title} compact />
      </div>
    );
  }
  return (
    <div className="aspect-[16/9] bg-slate-100 overflow-hidden">
      <img
        src={displaySrc.trim()}
        alt={title}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={() => setHide(true)}
      />
    </div>
  );
}
