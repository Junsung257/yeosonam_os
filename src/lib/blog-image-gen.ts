/**
 * Blog media adapter.
 *
 * New content uses the Yeosonam media pipeline:
 *   disclosed GPT conceptual cover -> deterministic branded graphic fallback.
 * Pexels/Gemini are intentionally not automatic fallbacks here.
 */

import { createHash } from 'node:crypto';
import { destToEnKeyword } from '@/lib/pexels';
import { buildBlogImageSearchQuery } from '@/lib/blog-image-relevance';
import {
  isMediaCodexEnabled,
  MEDIA_BRIEF_VERSION,
  renderDeterministicMedia,
  type MediaPurpose,
} from '@/lib/media-generation';

/** Retained for query-quality regression tests and legacy manual tooling. */
export function buildSearchQuery(sectionTitle: string, destination: string, keyword: string): string {
  const destinationQuery = destination ? destToEnKeyword(destination) : 'travel destination';
  return buildBlogImageSearchQuery({
    destinationQuery,
    primaryKeyword: keyword,
    sectionTitle,
  });
}
interface GeminiInteractionImage {
  data: string;
  mimeType: string;
}

/** @deprecated Compatibility parser for historical Gemini response fixtures. */
export function extractGeminiInteractionImage(value: unknown): GeminiInteractionImage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  const direct = response.output_image;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    const record = direct as Record<string, unknown>;
    if (typeof record.data === 'string' && record.data.length > 0) {
      return {
        data: record.data,
        mimeType: typeof record.mime_type === 'string' ? record.mime_type : 'image/jpeg',
      };
    }
  }
  const steps = Array.isArray(response.steps) ? response.steps : [];
  for (const step of [...steps].reverse()) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
    const stepRecord = step as Record<string, unknown>;
    if (stepRecord.type !== 'model_output' || !Array.isArray(stepRecord.content)) continue;
    for (const block of [...stepRecord.content].reverse()) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
      const blockRecord = block as Record<string, unknown>;
      if (blockRecord.type === 'image' && typeof blockRecord.data === 'string' && blockRecord.data.length > 0) {
        return {
          data: blockRecord.data,
          mimeType: typeof blockRecord.mime_type === 'string' ? blockRecord.mime_type : 'image/jpeg',
        };
      }
    }
  }
  return null;
}

/** Retained as the public prompt-policy regression surface. */
export function buildGeneratedBlogImagePrompt(prompt: string): string {
  return [
    'Create a high-quality editorial travel image for a Korean travel guide.',
    prompt,
    'Make the destination and the section intent visually relevant rather than using a generic postcard scene.',
    'Photorealistic natural lighting, realistic scale and colors, useful visual context, 16:9 horizontal composition.',
    'Use an observational editorial-photography composition, not a collage, advertisement, or staged influencer portrait.',
    'Do not invent a recognizable landmark unless the request explicitly names it.',
    'No text, no watermark, no logo, no readable signs, no menu prices, no identifiable person, no invented factual chart.',
    'Treat this as an illustrative reference image, not documentary proof of current conditions.',
  ].join(' ');
}

function stableOwnerId(sectionTitle: string, keyword: string, destination: string): string {
  return `blog-${createHash('sha256')
    .update(`${destination}:${keyword}:${sectionTitle}`)
    .digest('hex')
    .slice(0, 24)}`;
}

async function deterministicFallback(input: {
  ownerId: string;
  purpose: MediaPurpose;
  sectionTitle: string;
  keyword: string;
  destination: string;
}): Promise<string | null> {
  try {
    const asset = await renderDeterministicMedia({
      brief: {
        version: MEDIA_BRIEF_VERSION,
        ownerType: 'blog',
        ownerId: input.ownerId,
        purpose: input.purpose === 'blog_cover' ? 'brand_fallback' : input.purpose,
        assetClass: 'deterministic_graphic',
        locale: 'ko-KR',
        subject: `${input.destination || input.keyword} ${input.sectionTitle}`,
        destination: input.destination || null,
        factualConstraints: [input.keyword, input.sectionTitle].filter(Boolean),
        stylePreset: 'yeosonam_information',
        aspectRatio: '16:9',
        disclosureRequired: false,
      },
      eyebrow: input.destination || '여소남 여행 가이드',
      title: input.sectionTitle || input.keyword || '여행 핵심 가이드',
      lines: [
        input.keyword || '여행 준비 핵심 정보',
        '검증된 본문 내용을 기준으로 확인하세요',
      ],
      footer: '실제 일정·가격·운영 조건은 본문과 예약 안내를 확인하세요.',
      approvalMode: 'automatic',
    });
    return asset.url;
  } catch (error) {
    console.warn('[blog-image-gen] deterministic fallback failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function generateSectionImage(
  sectionTitle: string,
  keyword: string,
  destination?: string,
  options?: {
    skipPexelsFallback?: boolean;
    ownerId?: string;
    purpose?: Extract<MediaPurpose, 'blog_cover' | 'blog_inline_summary' | 'blog_inline_cta'>;
    approvalMode?: 'automatic' | 'manual';
  },
): Promise<string | null> {
  const dest = destination || keyword || '';
  const ownerId = options?.ownerId || stableOwnerId(sectionTitle, keyword, dest);
  const purpose = options?.purpose ?? 'blog_cover';
  return deterministicFallback({ ownerId, purpose, sectionTitle, keyword, destination: dest });
}

export function isAiImageGenConfigured(): boolean {
  return isMediaCodexEnabled();
}

export function isGeneratedBlogImageUrl(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  return /\/storage\/v1\/object\/public\/blog-assets\/generated\/blog\//i.test(value)
    || /\/storage\/v1\/object\/public\/media-assets\/openai_generated\/blog\//i.test(value);
}
