import { isSafeImageSrc } from '@/lib/image-url';

type AnyRecord = Record<string, unknown>;

export const BRAND_FALLBACK_IMAGE = '/logo.png';

export type PublicImageReadiness = {
  customerReady: boolean;
  approvedImageCount: number;
  brandFallbackCount: number;
};

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : null;
}

function imageUrl(value: unknown): unknown {
  if (typeof value === 'string') return value;
  const image = asRecord(value);
  return image?.url ?? image?.src_large ?? image?.src_medium ?? image?.src ?? null;
}

export function isBrandFallbackImage(value: unknown): boolean {
  const src = imageUrl(value);
  if (typeof src !== 'string' || !src.trim()) return false;

  try {
    return new URL(src.trim(), 'https://yeosonam.invalid').pathname === BRAND_FALLBACK_IMAGE;
  } catch {
    return src.trim().split(/[?#]/, 1)[0] === BRAND_FALLBACK_IMAGE;
  }
}

export function assessPublicImageReadiness(pkg: AnyRecord): PublicImageReadiness {
  const approved = new Set<string>();
  const fallbacks = new Set<string>();

  const addCandidate = (value: unknown, source?: unknown) => {
    const src = imageUrl(value);
    if (!isSafeImageSrc(src)) return;
    const normalized = String(src).trim();
    if (source === 'brand_fallback' || isBrandFallbackImage(normalized)) {
      fallbacks.add(normalized);
      return;
    }
    approved.add(normalized);
  };

  const images = Array.isArray(pkg.images_public) ? pkg.images_public : [];
  for (const item of images) {
    const image = asRecord(item);
    addCandidate(item, image?.source);
  }

  addCandidate(pkg.hero_image_url);
  addCandidate(pkg.lp_hero_image_url);
  for (const item of Array.isArray(pkg.thumbnail_urls) ? pkg.thumbnail_urls : []) {
    addCandidate(item);
  }

  return {
    customerReady: approved.size > 0,
    approvedImageCount: approved.size,
    brandFallbackCount: fallbacks.size,
  };
}

export function hasCustomerReadyPublicImage(pkg: AnyRecord): boolean {
  return assessPublicImageReadiness(pkg).customerReady;
}
