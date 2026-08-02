import { isSafeImageSrc } from '@/lib/image-url';

export type PublicImageAttribution = {
  url: string;
  photographer: string;
  provider: string;
  sourcePageUrl: string;
  license: string | null;
  licenseUrl: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeHttpUrl(value: unknown): string | null {
  const url = string(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function findPublicHeroAttribution(
  imagesPublic: unknown,
  heroImageUrl: unknown,
): PublicImageAttribution | null {
  const heroUrl = string(heroImageUrl);
  if (!heroUrl || !isSafeImageSrc(heroUrl) || !Array.isArray(imagesPublic)) return null;

  for (const item of imagesPublic) {
    const image = record(item);
    if (!image || image.source !== 'approved_destination' || string(image.url) !== heroUrl) continue;

    const photographer = string(image.photographer);
    const provider = string(image.provider);
    const sourcePageUrl = safeHttpUrl(image.source_page_url);
    if (!photographer || !provider || !sourcePageUrl) return null;

    return {
      url: heroUrl,
      photographer,
      provider,
      sourcePageUrl,
      license: string(image.license),
      licenseUrl: safeHttpUrl(image.license_url),
    };
  }

  return null;
}

export function publicImageAttributionLabel(attribution: PublicImageAttribution): string {
  const provider = attribution.provider === 'wikimedia_commons'
    ? 'Wikimedia Commons'
    : attribution.provider === 'pexels'
      ? 'Pexels'
      : attribution.provider === 'supplier_official'
        ? '공급사 제공'
        : '제공 이미지';
  return [attribution.photographer, provider, attribution.license].filter(Boolean).join(' · ');
}
