'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { isSafeImageSrc } from '@/lib/image-url';

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
  const ok = typeof src === 'string' && isSafeImageSrc(src);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src]);
  if (!ok || broken) return <>{fallback}</>;
  return (
    <img
      src={src.trim()}
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
  const ok = typeof src === 'string' && isSafeImageSrc(src);
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  if (!ok || broken) return <>{fallback}</>;
  return (
    <img
      src={src.trim()}
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

/** 블로그/매거진 카드 16:9 썸네일 — 임의 OG 도메인용 일반 img */
export function SafeMagazineThumb({ url, title, placeholderClassName }: MagazineProps) {
  const [hide, setHide] = useState(false);
  const ok = typeof url === 'string' && isSafeImageSrc(url) && !hide;
  useEffect(() => {
    setHide(false);
  }, [url]);
  if (!ok) {
    return (
      <div
        className={
          placeholderClassName ||
          'aspect-[16/9] bg-gradient-to-br from-brand-light to-[#F2F4F6] flex items-center justify-center text-3xl'
        }
      >
        📖
      </div>
    );
  }
  return (
    <div className="aspect-[16/9] bg-slate-100 overflow-hidden">
      <img
        src={url.trim()}
        alt={title}
        className="w-full h-full object-cover"
        loading="lazy"
        onError={() => setHide(true)}
      />
    </div>
  );
}
