/**
 * ══════════════════════════════════════════════════════════
 * Carousel Generator — Meta 캐러셀(카드뉴스) 3종 변형 생성
 * ══════════════════════════════════════════════════════════
 */

import { getWinningPatterns } from './get-patterns';
import { assignSlideRoles, decideSlideCount } from './design-slides';
import { generateCopies } from './generate-copy';
import type { ParsedProductData } from './parse-product';
import { searchPexelsPhotos, isPexelsConfigured } from '@/lib/pexels';

const HOOK_TYPES = ['urgency', 'benefit', 'scene', 'question', 'price'] as const;

export interface CarouselCreative {
  creative_type: 'carousel';
  channel: 'meta';
  variant_index: number;
  hook_type: string;
  tone: string;
  key_selling_point: string;
  target_segment: string;
  slides: {
    index: number;
    role: string;
    headline: string;
    body: string;
    image_url: string | null;
    pexels_keyword: string;
  }[];
}

export async function generateCarouselVariants(
  parsedData: ParsedProductData,
  count = 3,
): Promise<CarouselCreative[]> {
  // 승리 패턴 조회 → 높은 CTR 순으로 훅 타입 결정
  const patterns = await getWinningPatterns({
    destinationType: parsedData.destination_type,
    channel: 'meta',
    creativeType: 'carousel',
  });

  const hookPriority = patterns.length >= count
    ? patterns.slice(0, count).map(p => p.hook_type)
    : [
        ...patterns.map(p => p.hook_type),
        ...HOOK_TYPES.filter(h => !patterns.map(p => p.hook_type).includes(h)),
      ].slice(0, count);

  return Promise.all(
    hookPriority.map((hookType, i) =>
      generateOneCarousel(parsedData, hookType, i, patterns)
    )
  );
}

async function generateOneCarousel(
  parsedData: ParsedProductData,
  hookType: string,
  variantIndex: number,
  patterns: any[],
): Promise<CarouselCreative> {
  const slideCount = decideSlideCount(parsedData);
  const slideRoles = assignSlideRoles(parsedData, slideCount);

  const patternExample = patterns.find(p => p.hook_type === hookType);

  const copies = await generateCopies(slideRoles, hookType, patternExample);
  const images = await Promise.all(
    copies.map(c => getImage(c.pexels_keyword, parsedData.destination))
  );

  return {
    creative_type: 'carousel',
    channel: 'meta',
    variant_index: variantIndex,
    hook_type: hookType,
    tone: deriveTone(hookType),
    key_selling_point: deriveKeyPoint(parsedData, hookType),
    target_segment: 'middle_age',
    slides: slideRoles.map((role, i) => ({
      index: i,
      role: role.type,
      headline: copies[i]?.headline ?? '',
      body: copies[i]?.body ?? '',
      image_url: images[i] ?? null,
      pexels_keyword: copies[i]?.pexels_keyword ?? '',
    })),
  };
}

async function getImage(keyword: string, destination: string): Promise<string | null> {
  if (!isPexelsConfigured()) return null;

  try {
    const photos = await searchPexelsPhotos(keyword, 3);
    if (photos[0]?.src?.large2x) return photos[0].src.large2x;
  } catch { /* ignore */ }

  // fallback: 키워드 단순화
  try {
    const simple = keyword.split(' ').slice(0, 2).join(' ');
    const photos = await searchPexelsPhotos(simple, 3);
    if (photos[0]?.src?.large2x) return photos[0].src.large2x;
  } catch { /* ignore */ }

  // fallback: destination
  try {
    const photos = await searchPexelsPhotos(`${destination} travel`, 3);
    if (photos[0]?.src?.large2x) return photos[0].src.large2x;
  } catch { /* ignore */ }

  return null;
}

function deriveTone(hookType: string): string {
  const map: Record<string, string> = {
    urgency: 'urgent', benefit: 'trust', scene: 'emotional',
    question: 'emotional', price: 'informative',
  };
  return map[hookType] ?? 'trust';
}

function deriveKeyPoint(data: ParsedProductData, hookType: string): string {
  if (hookType === 'urgency') return data.seats_left != null && data.seats_left <= 3 ? 'seats_left' : 'deadline';
  if (hookType === 'benefit') return data.no_tip ? 'notip' : '5star';
  if (hookType === 'scene') return 'highlight_scene';
  if (hookType === 'price') return 'price_value';
  return 'notip';
}
