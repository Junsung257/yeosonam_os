import type { ProductBlogBrief } from './blog-product-brief';

type ProductForConsultant = {
  id: string;
  title?: string | null;
  destination?: string | null;
  duration?: number | null;
  nights?: number | null;
  price?: number | null;
  departure_airport?: string | null;
  airline?: string | null;
  inclusions?: string[] | null;
  excludes?: string[] | null;
  itinerary?: string[] | null;
  product_highlights?: string[] | null;
  optional_tours?: Array<{ name?: string | null; price_usd?: number | null }> | null;
};

function text(value: unknown, fallback = ''): string {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function money(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? `${value.toLocaleString()}원`
    : null;
}

function list(items: string[], fallback: string): string {
  const usable = items.map((item) => text(item)).filter(Boolean);
  if (usable.length === 0) return `- ${fallback}`;
  return usable.map((item) => `- ${item}`).join('\n');
}

function tableRows(label: string, items: string[], fallback: string): string[] {
  const usable = items.map((item) => text(item)).filter(Boolean).slice(0, 5);
  if (usable.length === 0) return [`| ${label} | ${fallback} | 상담에서 최종 확인 |`];
  return usable.map((item) => `| ${label} | ${item} | 상담에서 최종 확인 |`);
}

function packageUrl(productId: string): string {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com').replace(/\/$/, '');
  return `${baseUrl}/packages/${productId}?utm=blog_bottom`;
}

function inquiryUrl(productId: string): string {
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.yeosonam.com').replace(/\/$/, '');
  return `${baseUrl}/group-inquiry?utm_source=naver_blog&utm_medium=organic&utm_campaign=product_consultant&utm_content=${encodeURIComponent(productId)}`;
}

export function generateProductConsultantBlogPost(
  product: ProductForConsultant,
  brief: ProductBlogBrief,
): string {
  const destination = text(product.destination || brief.destination, '여행지');
  const title = text(product.title || brief.product_title, '패키지');
  const duration = brief.duration || (product.duration ? `${product.duration}일` : '일정 확인 필요');
  const price = money(brief.price_from);
  const departure = text(brief.departure_city || product.departure_airport, '출발지 상담 확인');
  const airline = text(product.airline, '항공 상담 확인');
  const highlights = Array.isArray(product.product_highlights) ? product.product_highlights.map((item) => text(item)).filter(Boolean).slice(0, 4) : [];
  const itinerary = Array.isArray(product.itinerary) ? product.itinerary.map((item) => text(item)).filter(Boolean).slice(0, 5) : [];
  const optionalTours = Array.isArray(product.optional_tours)
    ? product.optional_tours
      .map((tour) => [tour.name, tour.price_usd ? `$${tour.price_usd}` : null].filter(Boolean).join(' '))
      .filter(Boolean)
      .slice(0, 5)
    : [];
  const priceText = price ? `${price}부터` : '가격 상담 확인';

  return [
    `# ${destination} ${duration} 패키지: ${priceText}, 이런 분께 맞습니다`,
    '',
    `${departure} 출발 ${destination} ${duration} 상품을 보고 있다면, 이 글은 가격보다 먼저 포함사항과 일정 체감이 맞는지 확인하는 용도입니다. ${price ? `현재 확인 가능한 시작가는 ${priceText}이고, ` : ''}항공 시간, 호텔 등급, 선택관광은 문의 전에 다시 확인해야 합니다.`,
    '',
    '## 10초 판단',
    '',
    '| 확인 항목 | 현재 기준 | 문의 전 볼 점 |',
    '| --- | --- | --- |',
    `| 가격 | ${priceText} | 출발일, 좌석, 유류세에 따라 달라질 수 있음 |`,
    `| 출발 | ${departure} / ${airline} | 항공 시간과 수하물 조건 확인 |`,
    `| 기간 | ${duration} | 이동 많은 날과 휴식 시간 확인 |`,
    `| 적합 고객 | ${brief.fit_for[0] || '패키지 구성을 비교하는 고객'} | 동행자 연령과 이동 부담 확인 |`,
    '',
    '## 포함/불포함',
    '',
    '| 구분 | 항목 | 확인 포인트 |',
    '| --- | --- | --- |',
    ...tableRows('포함', brief.included, '상품 상세 포함사항 확인 필요'),
    ...tableRows('불포함', brief.excluded, '개인경비와 선택 비용 확인 필요'),
    '',
    '## 일정 체감',
    '',
    itinerary.length > 0
      ? itinerary.map((item, index) => `- ${index + 1}일차: ${item}`).join('\n')
      : '- 상세 일차별 일정은 상담에서 확정본 기준으로 확인해야 합니다.',
    '',
    highlights.length > 0 ? '### 먼저 볼 포인트' : '',
    highlights.length > 0 ? list(highlights, '상품 핵심 포인트는 상담에서 확인합니다.') : '',
    '',
    '## 이런 분께 맞습니다',
    '',
    list(brief.fit_for, `${destination} 패키지를 가격, 일정, 포함사항 기준으로 비교하려는 고객`),
    '',
    '## 이런 분께는 맞지 않을 수 있습니다',
    '',
    list(brief.not_fit_for, '자유일정 비중이 큰 여행을 원하는 고객'),
    '',
    '## 가격이 달라질 수 있는 조건',
    '',
    list(brief.risk_notes, '가격과 조건은 예약 시점에 달라질 수 있습니다.'),
    optionalTours.length > 0 ? '\n### 선택관광 확인\n' + list(optionalTours, '선택관광은 상담에서 확인합니다.') : '',
    '',
    '## 문의 전 질문',
    '',
    list(brief.consult_questions, '내 출발일과 인원 기준으로 가능한지 확인합니다.'),
    '',
    '## 내 일정 기준으로 확인하기',
    '',
    `- [상품 상세 먼저 보기](${packageUrl(product.id)})`,
    `- [이 출발일/인원 기준 가능 여부 확인](${inquiryUrl(product.id)})`,
    '',
    '<!-- writer: product_consultant_writer prompt_version: product-template-v2 -->',
  ].filter((part) => part !== '').join('\n');
}
