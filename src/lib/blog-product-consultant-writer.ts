import type { ProductBlogBrief } from './blog-product-brief';
import { resolveBlogCanonicalOrigin } from './blog-canonical-url';

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
    ? `${value.toLocaleString()}원~`
    : null;
}

function list(items: string[], fallback: string): string {
  const usable = items.map((item) => text(item)).filter(Boolean);
  if (usable.length === 0) return `- ${fallback}`;
  return usable.map((item) => `- ${item}`).join('\n');
}

function confirmationPoint(label: string, index: number): string {
  const includedPoints = [
    '상품 상세 포함 기준 확인',
    '요금 포함 여부 확인',
    '동행자 조건별 적용 확인',
    '예약 시점 조건 확인',
    '최종 안내문 기준 확인',
  ];
  const excludedPoints = [
    '현지 추가 비용 여부 확인',
    '1인 기준 금액 확인',
    '필수/선택 여부 확인',
    '출발일별 차이 확인',
    '결제 전 조건 확인',
  ];
  const points = label === '포함' ? includedPoints : excludedPoints;
  return points[index % points.length];
}

function tableRows(label: string, items: string[], fallback: string): string[] {
  const usable = items.map((item) => text(item)).filter(Boolean).slice(0, 5);
  if (usable.length === 0) return [`| ${label} | ${fallback} | ${confirmationPoint(label, 0)} |`];
  return usable.map((item, index) => `| ${label} | ${item} | ${confirmationPoint(label, index)} |`);
}

function packageUrl(productId: string): string {
  const baseUrl = resolveBlogCanonicalOrigin();
  return `${baseUrl}/packages/${productId}?utm=blog_bottom`;
}

function inquiryUrl(productId: string): string {
  const baseUrl = resolveBlogCanonicalOrigin();
  return `${baseUrl}/group-inquiry?utm_source=naver_blog&utm_medium=organic&utm_campaign=product_consultant&utm_content=${encodeURIComponent(productId)}`;
}

function variantIndex(seed: string, size: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return size > 0 ? hash % size : 0;
}

function buildOpeningParagraph(input: {
  productId: string;
  destination: string;
  duration: string;
  departure: string;
  priceText: string;
  fitFor: string;
}): string {
  const variants = [
    `${input.departure} 출발 ${input.destination} ${input.duration} 상품은 ${input.priceText} 기준으로 먼저 보는 편이 좋습니다. ${input.fitFor}라면 가격만 보지 말고 포함/불포함, 항공 시간, 객실 조건을 같이 확인해야 문의 전 판단이 쉬워집니다.`,
    `${input.destination} ${input.duration} 패키지는 ${input.departure} 출발과 ${input.priceText} 조건을 먼저 놓고 비교하면 됩니다. 특히 ${input.fitFor}에게는 일정 강도, 자유시간, 현지 추가비가 실제 만족도를 크게 좌우합니다.`,
    `${input.priceText}부터 보이는 ${input.destination} ${input.duration} 상품이라도 출발지와 포함 항목에 따라 체감 가격이 달라집니다. ${input.departure} 출발 기준으로 ${input.fitFor}에게 맞는지부터 확인해 보세요.`,
  ];
  return variants[variantIndex(input.productId, variants.length)];
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
  const highlights = Array.isArray(product.product_highlights)
    ? product.product_highlights.map((item) => text(item)).filter(Boolean).slice(0, 4)
    : [];
  const itinerary = Array.isArray(product.itinerary)
    ? product.itinerary.map((item) => text(item)).filter(Boolean).slice(0, 5)
    : [];
  const optionalTours = Array.isArray(product.optional_tours)
    ? product.optional_tours
      .map((tour) => [tour.name, tour.price_usd ? `$${tour.price_usd}` : null].filter(Boolean).join(' '))
      .filter(Boolean)
      .slice(0, 5)
    : [];
  const priceText = price ?? '가격 상담 확인';
  const firstFit = brief.fit_for[0] || `${destination} 패키지를 가격, 일정, 포함 항목 기준으로 비교하려는 분`;
  const opening = buildOpeningParagraph({
    productId: product.id,
    destination,
    duration,
    departure,
    priceText,
    fitFor: firstFit,
  });

  return [
    `# ${destination} ${duration} 패키지: ${priceText}, 이런 분께 맞습니다`,
    '',
    opening,
    '',
    '## 10초 판단',
    '',
    '| 확인 항목 | 현재 기준 | 문의 전 볼 점 |',
    '| --- | --- | --- |',
    `| 가격 | ${priceText} | 출발일, 좌석, 유류할증료에 따라 달라질 수 있음 |`,
    `| 출발 | ${departure} / ${airline} | 항공 시간과 수하물 조건 확인 |`,
    `| 기간 | ${duration} | 이동 부담과 자유시간 비중 확인 |`,
    `| 맞는 고객 | ${brief.fit_for[0] || '패키지 구성을 비교하는 고객'} | 동행자 연령과 이동 강도 확인 |`,
    '',
    '## 포함/불포함',
    '',
    '| 구분 | 항목 | 확인 포인트 |',
    '| --- | --- | --- |',
    ...tableRows('포함', brief.included, '상품 상세 포함 항목 확인 필요'),
    ...tableRows('불포함', brief.excluded, '개인경비와 선택 비용 확인 필요'),
    '',
    '## 일정 체감',
    '',
    itinerary.length > 0
      ? itinerary.map((item, index) => `- ${index + 1}일차: ${item}`).join('\n')
      : '- 일차별 상세 코스가 비어 있다면 항공 시간, 숙소 위치, 장거리 이동 구간부터 확인해야 합니다.',
    '',
    highlights.length > 0 ? '### 먼저 볼 포인트' : '',
    highlights.length > 0 ? list(highlights, '상품 핵심 포인트는 문의 전 확인합니다.') : '',
    '',
    '## 맞는 사람과 안 맞는 사람',
    '',
    '### 맞는 분',
    '',
    list(brief.fit_for, `${destination} 패키지를 가격, 일정, 포함 항목 기준으로 비교하려는 분`),
    '',
    '### 안 맞는 사람',
    '',
    list(brief.not_fit_for, '자유일정 비중이 큰 개별여행을 원하는 분'),
    '',
    '## 가격 변동 조건',
    '',
    list(brief.risk_notes, '가격과 조건은 예약 시점에 따라 달라질 수 있습니다.'),
    optionalTours.length > 0 ? '\n### 선택관광 확인\n' + list(optionalTours, '선택관광은 문의 전 확인합니다.') : '',
    '',
    '## 문의 전 질문',
    '',
    list(brief.consult_questions, '출발일과 인원 기준 가능 여부를 확인합니다.'),
    '',
    '## 자주 묻는 질문',
    '',
    `Q. ${destination} ${duration} 가격은 확정인가요?`,
    'A. 표기된 금액은 시작가 기준입니다. 출발일, 좌석, 객실 조건, 유류할증료에 따라 달라질 수 있습니다.',
    '',
    'Q. 포함/불포함은 어디를 봐야 하나요?',
    'A. 위 표의 포함/불포함을 먼저 보고, 개인경비와 선택관광은 문의 전 다시 확인하는 편이 안전합니다.',
    '',
    'Q. 일정 강도는 어떻게 판단하나요?',
    'A. 이동 시간, 자유시간, 숙소 위치를 같이 보면 동행자에게 맞는지 판단하기 쉽습니다.',
    '',
    '공식 출입국과 항공 조건은 아래 자료도 함께 확인하세요.',
    '',
    '- [외교부 해외안전여행](https://www.0404.go.kr/)',
    '- [IATA Travel Centre](https://www.iatatravelcentre.com/)',
    '',
    '### 내 일정 기준으로 확인',
    '',
    `- [상품 조건 먼저 보기](${packageUrl(product.id)})`,
    `- [출발일과 인원 기준 가능 여부 확인](${inquiryUrl(product.id)})`,
    '',
    '<!-- writer: product_consultant_writer prompt_version: product-template-v2 -->',
  ].join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}
