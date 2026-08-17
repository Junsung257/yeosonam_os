/**
 * Image metadata must describe the pixels, not the article keyword.
 * Deterministic finalization therefore preserves authored metadata and never
 * invents an alt or caption from a destination, heading, or keyword.
 */

export interface ImageSeoMeta {
  alt: string;
  caption?: string;
  suggestedFilename?: string;
}

/**
 * 본문 컨텍스트와 목적지/키워드를 기반으로 이미지 SEO 메타 생성
 * - AI 호출 없이 휴리스틱 규칙으로 처리 (실시간, 제로 비용)
 */
export function generateImageSeoMeta(
  _imageIndex: number,
  _totalImages: number,
  _context: {
    destination?: string | null;
    primaryKeyword?: string | null;
    sectionTitle?: string;
  },
): ImageSeoMeta {
  return { alt: '' };
}

/**
 * 블로그 HTML의 모든 이미지에 alt 텍스트를 일괄 생성/보강
 * - 이미 alt가 있으면 통과
 * - alt가 없거나 비어있으면 생성하여 삽입
 * - caption은 이미지 바로 아래 <figcaption> 또는 <em>으로 추가
 */
export function optimizeImageSeoInHtml(
  html: string,
  _destination?: string | null,
  _primaryKeyword?: string | null,
): string {
  return html;
}
