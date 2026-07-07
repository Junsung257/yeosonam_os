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

const AIRLINE_NAMES: Record<string, string> = {
  LJ: '진에어',
  BX: '에어부산',
  '7C': '제주항공',
  TW: '티웨이항공',
  ZE: '이스타항공',
  VJ: '비엣젯항공',
  CI: '중화항공',
  KE: '대한항공',
  OZ: '아시아나항공',
};

const CUSTOMER_HIDDEN_INFO_RE =
  /(?:커미션|수수료율|마진|원가|공급가|정산가|랜드사\s*정산|B2B|담당자|직원|내부\s*메모|계좌번호|입금처|도매가|대리점용|판매자용|카드\s*수수료|현금\s*유도)/i;

function text(value: unknown, fallback = ''): string {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function customerText(value: unknown, fallback = ''): string {
  const cleaned = text(value, fallback);
  return CUSTOMER_HIDDEN_INFO_RE.test(cleaned) ? '' : cleaned;
}

function money(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? `${value.toLocaleString()}원`
    : null;
}

function list(items: string[], fallback: string): string {
  const usable = items.map((item) => customerText(item)).filter(Boolean);
  if (usable.length === 0) return `- ${fallback}`;
  return usable.map((item) => `- ${item}`).join('\n');
}

function tableRows(label: string, items: string[], fallback: string): string[] {
  const usable = items.map((item) => customerText(item)).filter(Boolean).slice(0, 5);
  if (usable.length === 0) return [`| ${label} | ${fallback} | 상담에서 최종 확인 |`];
  return usable.map((item) => `| ${label} | ${item} | 상담에서 최종 확인 |`);
}

function airlineDisplay(value: unknown): string {
  const raw = text(value, '항공 상담 확인');
  const normalized = raw.toUpperCase();
  if (AIRLINE_NAMES[normalized]) return `${AIRLINE_NAMES[normalized]}(${normalized})`;
  return customerText(raw, '항공 상담 확인') || '항공 상담 확인';
}

function departureDisplay(value: unknown): string {
  const raw = customerText(value, '출발지 상담 확인');
  if (!raw || raw.includes('상담 확인')) return raw || '출발지 상담 확인';
  return /출발/.test(raw) ? raw : `${raw} 출발`;
}

function productSeoTitle(destination: string, duration: string, departure: string, priceText: string): string {
  const departurePart = departure.includes('상담 확인') ? '' : `${departure} `;
  const decisionKeyword = priceText.includes('상담') ? '조건 확인' : '가격 조건';
  return `${departurePart}${destination} ${duration} 패키지 ${decisionKeyword}`
    .replace(/\s+/g, ' ')
    .trim();
}

function packageUrl(productId: string): string {
  const baseUrl = resolveBlogCanonicalOrigin();
  return `${baseUrl}/packages/${productId}?utm=blog_bottom`;
}

function inquiryUrl(productId: string): string {
  const baseUrl = resolveBlogCanonicalOrigin();
  return `${baseUrl}/group-inquiry?utm_source=naver_blog&utm_medium=organic&utm_campaign=product_consultant&utm_content=${encodeURIComponent(productId)}`;
}

export function generateProductConsultantBlogPost(
  product: ProductForConsultant,
  brief: ProductBlogBrief,
): string {
  const destination = customerText(product.destination || brief.destination, '여행지') || '여행지';
  const duration = brief.duration || (product.duration ? `${product.duration}일` : '일정 확인 필요');
  const price = money(brief.price_from);
  const departure = departureDisplay(brief.departure_city || product.departure_airport);
  const airline = airlineDisplay(product.airline);
  const highlights = Array.isArray(product.product_highlights)
    ? product.product_highlights.map((item) => customerText(item)).filter(Boolean).slice(0, 4)
    : [];
  const itinerary = Array.isArray(product.itinerary)
    ? product.itinerary.map((item) => customerText(item)).filter(Boolean).slice(0, 5)
    : [];
  const optionalTours = Array.isArray(product.optional_tours)
    ? product.optional_tours
      .map((tour) => [tour.name, tour.price_usd ? `$${tour.price_usd}` : null].filter(Boolean).join(' '))
      .filter(Boolean)
      .slice(0, 5)
    : [];
  const priceText = price ? `${price}부터` : '가격 상담 확인';
  const seoTitle = productSeoTitle(destination, duration, departure, priceText);

  return [
    `# ${seoTitle}`,
    '',
    `${destination} ${duration} 패키지는 가격만 보지 말고 출발지, 포함사항, 일정 강도를 같이 봐야 판단이 쉽습니다. ${departure} 기준으로 ${price ? `현재 확인 가능한 시작가는 ${priceText}이고, ` : ''}항공 시간, 객실 조건, 선택관광은 문의 전에 다시 확인해야 합니다.`,
    '',
    '## 10초 판단',
    '',
    '| 확인 항목 | 현재 기준 | 문의 때 볼 점 |',
    '| --- | --- | --- |',
    `| 가격 | ${priceText} | 출발일, 좌석, 유류할증료에 따라 달라질 수 있음 |`,
    `| 출발 | ${departure} / ${airline} | 항공 시간과 수하물 조건 확인 |`,
    `| 기간 | ${duration} | 이동량과 휴식 시간 확인 |`,
    `| 맞는 고객 | ${brief.fit_for[0] || '패키지 구성을 비교하는 고객'} | 동행자 연령과 이동 부담 확인 |`,
    '',
    '## 포함/불포함은 이렇게 나눠 봅니다',
    '',
    '| 구분 | 항목 | 확인 포인트 |',
    '| --- | --- | --- |',
    ...tableRows('포함', brief.included, '상품 상세 포함사항 확인 필요'),
    ...tableRows('불포함', brief.excluded, '개인경비와 선택 비용 확인 필요'),
    '',
    '## 일정은 이동과 자유시간을 같이 봅니다',
    '',
    itinerary.length > 0
      ? itinerary.map((item, index) => `- ${index + 1}일차: ${item}`).join('\n')
      : '- 상세 일차별 일정은 상담에서 확정본 기준으로 확인해야 합니다.',
    '',
    highlights.length > 0 ? '### 먼저 볼 포인트' : '',
    highlights.length > 0 ? list(highlights, '상품 핵심 포인트는 상담에서 확인합니다.') : '',
    '',
    '## 이런 분께 맞고, 맞지 않을 수 있는 사람',
    '',
    '### 맞는 사람',
    '',
    list(brief.fit_for, `${destination} 패키지를 가격, 일정, 포함사항 기준으로 비교하려는 고객`),
    '',
    '### 맞지 않을 수 있는 사람',
    '',
    list(brief.not_fit_for, '자유일정 비중이 큰 여행을 원하는 고객'),
    '',
    '## 가격이 달라질 수 있는 조건과 숨기지 않고 봐야 할 부분',
    '',
    '### 가격과 추가 비용',
    '',
    list(brief.risk_notes, '가격과 조건은 예약 시점에 달라질 수 있습니다.'),
    optionalTours.length > 0 ? '\n### 선택관광 확인\n' + list(optionalTours, '선택관광은 상담에서 확인합니다.') : '',
    '',
    '### 고객에게 중요한 제한',
    '',
    list([
      ...brief.excluded,
      ...brief.risk_notes,
    ], '쇼핑, 기사·가이드 경비, 싱글차지, 써차지, 객실 배정 제한은 원문에 있을 때 반드시 확인합니다.'),
    '',
    '### 문의 전 질문',
    '',
    list(brief.consult_questions, '출발일과 인원 기준으로 가능한지 확인합니다.'),
    '',
    '## 자주 묻는 질문?',
    '',
    `Q. ${destination} ${duration} 가격은 확정인가요?`,
    `A. 시작가 기준이며 출발일, 좌석, 유류할증료, 객실 조건에 따라 달라질 수 있습니다.`,
    '',
    'Q. 포함/불포함은 어디를 봐야 하나요?',
    'A. 위 표의 포함/불포함을 먼저 보고, 개인경비와 선택관광은 상담 때 다시 확인하는 편이 안전합니다.',
    '',
    'Q. 일정 강도는 어떻게 판단하나요?',
    'A. 이동 시간이 긴 날, 자유시간, 호텔 위치를 함께 보면 동행자에게 맞는지 판단하기 쉽습니다.',
    '',
    '공식 출입국·항공 조건은 아래 자료도 함께 확인하세요.',
    '',
    '- [외교부 해외안전여행](https://www.0404.go.kr/)',
    '- [IATA 여행센터](https://www.iatatravelcentre.com/)',
    '',
    '### 내 일정 기준으로 확인하기',
    '',
    `- [상품 상세 먼저 보기](${packageUrl(product.id)})`,
    `- [출발일과 인원 기준 가능 여부 확인](${inquiryUrl(product.id)})`,
    '',
    '<!-- writer: product_consultant_writer prompt_version: product-template-v2 -->',
  ].join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}
