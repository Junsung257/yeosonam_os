import { ensureBlogInlineImages } from '@/lib/blog-inline-images';
import { optimizeImageSeoInHtml } from '@/lib/blog-image-seo';
import { normalizeBlogContent } from '@/lib/blog-quality-normalizer';

interface FinalizeBlogPostInput {
  blogHtml: string;
  destination?: string | null;
  primaryKeyword?: string | null;
  ogImageUrl?: string | null;
  inlineImageSeedUrl?: string | null;
  minImages?: number;
  maxImages?: number;
  fallbackOgImageUrl?: string | null;
}

export interface FinalizeBlogPostResult {
  blogHtml: string;
  ogImageUrl: string | null;
  imageCount: number;
  insertedImages: number;
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isGenericOgImage(url: string | null): boolean {
  if (!url) return false;
  return /\/og-image\.png(?:[?#].*)?$/i.test(url);
}

export async function finalizeBlogPost(input: FinalizeBlogPostInput): Promise<FinalizeBlogPostResult> {
  const resolvedOgImageUrl =
    normalizeUrl(input.ogImageUrl) ??
    normalizeUrl(input.fallbackOgImageUrl) ??
    null;

  const inlineImageSeedUrl = normalizeUrl(input.inlineImageSeedUrl) ?? resolvedOgImageUrl;
  const usableInlineSeed = isGenericOgImage(inlineImageSeedUrl) ? null : inlineImageSeedUrl;

  const imageResult = await ensureBlogInlineImages({
    markdown: input.blogHtml,
    destination: input.destination,
    primaryKeyword: input.primaryKeyword,
    ogImageUrl: usableInlineSeed,
    minImages: input.minImages,
    maxImages: input.maxImages,
  });

  const optimizedHtml = optimizeImageSeoInHtml(
    imageResult.markdown,
    input.destination,
    input.primaryKeyword,
  );
  const normalizedHtml = normalizeBlogContent({
    markdown: optimizedHtml,
    destination: input.destination,
    primaryKeyword: input.primaryKeyword,
  });

  return {
    blogHtml: normalizedHtml,
    ogImageUrl: resolvedOgImageUrl,
    imageCount: imageResult.imageCount,
    insertedImages: imageResult.inserted,
  };
}
