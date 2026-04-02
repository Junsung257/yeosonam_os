/**
 * Creative Engine — 여소남 광고 소재 공장
 * 엔트리 포인트
 */

export { parseProduct } from './parse-product';
export type { ParsedProductData } from './parse-product';
export { classifyDestinationType, classifyPrice, classifyNights } from './parse-product';

export { decideSlideCount, assignSlideRoles } from './design-slides';
export type { SlideRole, SlideRoleType } from './design-slides';

export { generateCopies } from './generate-copy';
export type { GeneratedCopy } from './generate-copy';

export { generateCarouselVariants } from './carousel-generator';
export type { CarouselCreative } from './carousel-generator';

export { generateSingleImageVariants } from './single-image-generator';
export type { SingleImageCreative } from './single-image-generator';

export { generateTextAdVariants } from './text-ad-generator';
export type { TextAdCreative } from './text-ad-generator';

export { getWinningPatterns } from './get-patterns';
export type { WinningPatternRow } from './get-patterns';

export { updateWinningPatterns } from './update-patterns';

export { dailySync } from './sync-performance';
