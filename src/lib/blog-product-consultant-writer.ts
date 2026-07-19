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

function tableRows(label: string, items: string[], fallback: string): string[] {
  const usable = items.map((item) => text(item)).filter(Boolean).slice(0, 5);
  const points = label === '포함'
    ? ['상품 상세 포함 기준 확인', '출발일별 적용 여부 확인', '현지 제공 방식 확인', '동행자 조건 확인', '최종 일정 기준 확인']
    : ['현지 추가비 여부 확인', '1인 기준 금액 확인', '필수/선택 여부 확인', '결제 시점 확인', '취소 규정 포함 확인'];
  if (usable.length === 0) return [`| ${label} | ${fallback} | 상담 시점 기준으로 다시 확인 |`];
  return usable.map((item, index) => `| ${label} | ${item} | ${points[index % points.length]} |`);
}

function packageUrl(productId: string): string {
  const baseUrl = resolveBlogCanonicalOrigin();
  return `${baseUrl}/packages/${productId}?utm=blog_bottom`;
}

function inquiryUrl(productId: string): string {
  const baseUrl = resolveBlogCanonicalOrigin();
  return `${baseUrl}/group?utm_source=naver_blog&utm_medium=organic&utm_campaign=product_consultant&utm_content=${encodeURIComponent(productId)}`;
}

function firstSentence(input: {
  destination: string;
  duration: string;
  departure: string;
  priceText: string;
  fitFor: string;
}): string {
  return `${input.departure} 출발 ${input.destination} ${input.duration} 상품은 ${input.priceText} 기준으로 보되, ${input.fitFor}에게 일정이 무리 없는지까지 같이 보면 좋아요.`;
}

export function generateProductConsultantBlogPost(
  product: ProductForConsultant,
  brief: ProductBlogBrief,
): string {
  const destination = text(product.destination || brief.destination, '여행지');
  const title = text(product.title || brief.product_title, `${destination} 패키지`);
  const duration = brief.duration || (product.duration ? `${product.duration}일` : '일정 확인 필요');
  const priceText = money(brief.price_from) ?? '가격 상담 확인';
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
  const fitFor = brief.fit_for[0] || `${destination} 패키지를 가격과 일정 기준으로 비교하고 싶은 분`;
  const opening = [
    firstSentence({ destination, duration, departure, priceText, fitFor }),
    `같은 ${duration}이라도 출발일, 항공, 객실, 포함 항목에 따라 실제 결제 금액은 달라질 수 있습니다.`,
    '아래 내용은 등록된 상품 정보 기준으로만 정리했습니다. 호텔명이나 확정 혜택처럼 상품 DB에 없는 내용은 임의로 만들지 않았어요.',
  ].join('\n\n');

  return [
    `# ${departure} 출발 ${destination} ${duration} 패키지 ${priceText} 조건 체크`,
    '',
    opening,
    '',
    '## 10초 판단',
    '',
    '| 확인 항목 | 현재 기준 | 문의 전 볼 것 |',
    '| --- | --- | --- |',
    `| 가격 | ${priceText} | 출발일, 좌석, 유류할증료에 따라 변동 가능 |`,
    `| 출발 | ${departure} / ${airline} | 항공 시간과 수하물 조건 확인 |`,
    `| 기간 | ${duration} | 이동일과 실제 현지 체류 시간 구분 |`,
    `| 맞는 고객 | ${fitFor} | 동행자 연령과 이동 강도 확인 |`,
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
      : '- 일차별 상세 코스가 비어 있다면 항공 시간, 숙소 위치, 장거리 이동 구간부터 먼저 확인하는 것이 좋습니다.',
    '',
    highlights.length > 0 ? '### 먼저 볼 포인트' : '',
    highlights.length > 0 ? list(highlights, '상품 핵심 포인트는 상담 시점에 다시 확인합니다.') : '',
    '',
    '## 맞는 사람과 안 맞는 사람',
    '',
    '### 맞는 사람',
    '',
    list(brief.fit_for, `${destination} 패키지를 가격, 일정, 포함 항목 기준으로 비교하고 싶은 분`),
    '',
    '### 안 맞는 사람',
    '',
    list(brief.not_fit_for, '자유일정 비중이 높은 개별여행을 원하는 분'),
    '',
    '## 가격 변동 조건',
    '',
    list(brief.risk_notes, '가격과 조건은 예약 시점에 따라 달라질 수 있습니다.'),
    optionalTours.length > 0 ? '\n### 선택관광 확인\n' + list(optionalTours, '선택관광은 문의 시점에 확인합니다.') : '',
    '',
    '## 문의 전 질문',
    '',
    list(brief.consult_questions, '출발일과 인원 기준 가능 여부를 확인해요.'),
    '',
    '## 자주 묻는 질문',
    '',
    `Q. ${destination} ${duration} 가격은 확정인가요?`,
    'A. 표시 금액은 시작가 기준입니다. 출발일, 좌석, 객실 조건, 유류할증료에 따라 달라질 수 있습니다.',
    '',
    'Q. 포함/불포함은 어디를 먼저 보면 되나요?',
    'A. 위 표의 포함/불포함을 먼저 보고, 개인경비와 선택관광은 문의 전에 다시 확인하는 편이 안전합니다.',
    '',
    'Q. 일정 강도는 어떻게 판단하나요?',
    'A. 이동 시간, 자유시간, 숙소 위치를 함께 보면 동행자에게 맞는지 판단하기 쉬워요.',
    '',
    '공식 출입국과 항공 조건은 아래 자료에서 함께 확인하세요.',
    '',
    '- [외교부 해외안전여행](https://www.0404.go.kr/)',
    '- [IATA Travel Centre](https://www.iatatravelcentre.com/)',
    '',
    '### 이 출발일 기준으로 확인',
    '',
    `- [상품 조건 먼저 보기](${packageUrl(product.id)})`,
    `- [출발일과 인원 기준 가능 여부 확인](${inquiryUrl(product.id)})`,
    '',
    `<!-- writer: product_consultant_writer prompt_version: ${brief.prompt_version} source: product_db -->`,
    `<!-- product_title: ${title.replace(/-->/g, '')} -->`,
  ].join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}
