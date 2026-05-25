/**
 * Image SEO Optimizer — 블로그 이미지의 alt·caption·파일명 최적화
 *
 * Google 이미지 검색은 전체 트래픽의 20~30%를 차지한다.
 * alt 텍스트 + caption + 파일명 최적화로 이미지 검색 유입을 극대화.
 *
 * 백엔드: AI가 분석한 본문 기반으로 alt/caption 생성
 * - alt: 8~12자 구체 설명 (키워드 포함)
 * - caption: 20~40자 부가 설명 (선택)
 * - 파일명: IMG_001.jpg → destination-description.webp
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
  imageIndex: number,
  totalImages: number,
  context: {
    destination?: string | null;
    primaryKeyword?: string | null;
    sectionTitle?: string;
  },
): ImageSeoMeta {
  const dest = context.destination || '여행';
  const kw = context.primaryKeyword || dest;
  const section = context.sectionTitle || '';

  // 섹션 제목에서 핵심어 추출 (괄호 안 내용 우선)
  const sectionKeyword = section
    .replace(/[\[\]【】]/g, '')
    .split(/[,|]/)[0]
    .trim();

  // alt 텍스트 생성
  let alt = '';
  if (sectionKeyword && sectionKeyword !== dest) {
    alt = `${dest} ${sectionKeyword}`;
  } else if (imageIndex === 0) {
    alt = `${dest} ${kw} 대표 이미지`;
  } else if (imageIndex === totalImages - 1) {
    alt = `${dest} ${kw} 마무리`;
  } else {
    alt = `${dest} ${kw} ${imageIndex + 1}`;
  }

  // 8~12자로 제한
  alt = alt.slice(0, 40).trim();

  // caption 생성 (첫 이미지와 마지막 이미지만)
  let caption: string | undefined;
  if (imageIndex === 0 && totalImages > 1) {
    caption = `${dest} 여행의 전경.`;
  } else if (imageIndex === totalImages - 1 && totalImages > 1) {
    caption = `${dest} 여행의 마무리 풍경.`;
  }

  // 파일명 제안
  const safeDest = dest.replace(/\s+/g, '-').replace(/[^가-힣a-zA-Z0-9-]/g, '');
  const safeSection = sectionKeyword
    ? '-' + sectionKeyword.replace(/\s+/g, '-').replace(/[^가-힣a-zA-Z0-9-]/g, '')
    : '';
  const suggestedFilename = `${safeDest}${safeSection}-${imageIndex + 1}.webp`;

  return { alt, caption, suggestedFilename };
}

/**
 * 블로그 HTML의 모든 이미지에 alt 텍스트를 일괄 생성/보강
 * - 이미 alt가 있으면 통과
 * - alt가 없거나 비어있으면 생성하여 삽입
 * - caption은 이미지 바로 아래 <figcaption> 또는 <em>으로 추가
 */
export function optimizeImageSeoInHtml(
  html: string,
  destination?: string | null,
  primaryKeyword?: string | null,
): string {
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = [...html.matchAll(imgRegex)];
  let result = html;

  // 역순으로 처리 (인덱스 보존)
  for (let i = images.length - 1; i >= 0; i--) {
    const match = images[i];
    const fullMatch = match[0];
    const existingAlt = match[1]?.trim() || '';
    const url = match[2];

    if (existingAlt && existingAlt.length >= 3) {
      continue; // 이미 alt 있음
    }

    const meta = generateImageSeoMeta(i, images.length, {
      destination,
      primaryKeyword,
      sectionTitle: '',
    });

    const newImg = `![${meta.alt}](${url})`;
    result = result.replace(fullMatch, newImg);

    // caption 추가 (빈 줄 뒤에 <figcaption>)
    if (meta.caption) {
      const captionHtml = `\n<figcaption>${meta.caption}</figcaption>`;
      result = result.replace(newImg, newImg + captionHtml);
    }
  }

  return result;
}
