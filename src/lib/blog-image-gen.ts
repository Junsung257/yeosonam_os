/**
 * AI Image Generation Pipeline
 *
 * 블로그 각 H2 섹션에 어울리는 이미지를 AI(Gemini native image)로 생성하거나
 * Pexels에서 검색하여 자동 삽입.
 *
 * 실패 체인: Gemini native image → Supabase Storage → Pexels 검색 → null
 *
 * Rate limit 보호: 한 번 호출당 최소 1초 간격
 */

import { getSecret } from '@/lib/secret-registry';
import { supabaseAdmin } from '@/lib/supabase';
import { destToEnKeyword, searchPexelsPhotos } from '@/lib/pexels';
import { buildBlogImageSearchQuery, selectRelevantPexelsPhoto } from '@/lib/blog-image-relevance';
import { createHash } from 'node:crypto';

const BLOG_IMAGE_MODEL = process.env.BLOG_IMAGE_MODEL ?? 'gemini-3.1-flash-image';
const BLOG_IMAGE_BUCKET = 'blog-assets';

let lastCallTs = 0;

/**
 * rate limit 방어: 최소 1초 간격
 */
async function rateLimitGuard(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTs;
  if (elapsed < 1000) {
    await new Promise((r) => setTimeout(r, 1000 - elapsed));
  }
  lastCallTs = Date.now();
}

/**
 * 섹션 제목(한국어)을 분석해 이미지 검색용 영어 키워드 생성
 */
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

async function persistGeneratedImage(base64: string, mimeType: string): Promise<string | null> {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > 6 * 1024 * 1024) return null;
  const extension = mimeType === 'image/png' ? 'png' : 'jpg';
  const hash = createHash('sha256').update(bytes).digest('hex');
  const storagePath = `generated/blog/${hash.slice(0, 2)}/${hash}.${extension}`;
  const { error } = await supabaseAdmin.storage
    .from(BLOG_IMAGE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      cacheControl: '31536000',
      upsert: false,
    });

  if (error && !/already exists|duplicate/i.test(error.message)) {
    console.warn(`[blog-image-gen] generated image storage upload failed: ${error.message}`);
    return null;
  }

  const { data } = supabaseAdmin.storage.from(BLOG_IMAGE_BUCKET).getPublicUrl(storagePath);
  return /^https:\/\//i.test(data.publicUrl) ? data.publicUrl : null;
}

/**
 * Gemini native image API를 통해 이미지 생성 시도
 * 환경변수: GEMINI_API_KEY
 * 엔드포인트: https://generativelanguage.googleapis.com/v1beta/interactions
 */
async function tryGeminiImage(prompt: string): Promise<string | null> {
  const apiKey = getSecret('GEMINI_API_KEY') || getSecret('GOOGLE_GEMINI_API_KEY');
  if (!apiKey) return null;

  try {
    await rateLimitGuard();

    const imagePrompt = buildGeneratedBlogImagePrompt(prompt);

    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          model: BLOG_IMAGE_MODEL,
          input: imagePrompt,
          response_format: {
            type: 'image',
            mime_type: 'image/jpeg',
            aspect_ratio: '16:9',
            image_size: '1K',
          },
        }),
        signal: AbortSignal.timeout(45000),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[blog-image-gen] Gemini image generation failed (${res.status}): ${errText.substring(0, 200)}`);
      return null;
    }

    const generated = extractGeminiInteractionImage(await res.json());
    if (!generated) {
      console.warn('[blog-image-gen] Gemini response did not contain an image');
      return null;
    }
    return persistGeneratedImage(generated.data, generated.mimeType);
  } catch (err) {
    console.warn(
      '[blog-image-gen] Gemini image generation exception:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Pexels 검색으로 이미지 URL 획득 (fallback)
 */
async function tryPexelsSearch(
  query: string,
  destination: string,
  keyword: string,
  sectionTitle: string,
): Promise<string | null> {
  try {
    await rateLimitGuard();
    const photos = await searchPexelsPhotos(query, 18, 1);
    const photo = selectRelevantPexelsPhoto(photos, {
      destinationQuery: destination ? destToEnKeyword(destination) : 'travel destination',
      primaryKeyword: keyword,
      sectionTitle,
    });
    return photo
      ? photo.src.landscape || photo.src.large || photo.src.original
      : null;
  } catch (err) {
    console.warn(
      '[blog-image-gen] Pexels 검색 실패:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * 섹션 제목에 맞는 이미지 URL을 생성한다.
 *
 * @param sectionTitle - H2 섹션 제목 (한국어)
 * @param keyword      - 블로그 메인 키워드
 * @param destination  - 여행 목적지
 * @returns 이미지 URL 또는 null
 *
 * 실패 체인:
 *   1. Gemini native image 생성 후 공개 Storage 업로드 (GEMINI_API_KEY 필요)
 *   2. Pexels 검색 (PEXELS_API_KEY 필요)
 *   3. null 반환
 */
export async function generateSectionImage(
  sectionTitle: string,
  keyword: string,
  destination?: string,
  options?: { skipPexelsFallback?: boolean },
): Promise<string | null> {
  const dest = destination || keyword || '';

  // AI 이미지 생성 비활성화 여부 확인
  const aiEnabled = getSecret('AI_IMAGE_GEN_ENABLED') !== 'false';

  const searchQuery = buildSearchQuery(sectionTitle, dest, keyword);

  // 1) Gemini native image 시도
  if (aiEnabled) {
    const generatedUrl = await tryGeminiImage(`${dest}. ${keyword}. Section: ${sectionTitle}.`);
    if (generatedUrl) return generatedUrl;
  }

  // 2) Pexels fallback
  if (!options?.skipPexelsFallback) {
    const pexelsUrl = await tryPexelsSearch(searchQuery, dest, keyword, sectionTitle);
    if (pexelsUrl) return pexelsUrl;
  }

  return null;
}

/**
 * AI 이미지 생성 기능이 설정되었는지 확인
 */
export function isAiImageGenConfigured(): boolean {
  return !!(getSecret('GEMINI_API_KEY') || getSecret('GOOGLE_GEMINI_API_KEY') || getSecret('PEXELS_API_KEY'));
}

export function isGeneratedBlogImageUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && /\/storage\/v1\/object\/public\/blog-assets\/generated\/blog\//i.test(value);
}
