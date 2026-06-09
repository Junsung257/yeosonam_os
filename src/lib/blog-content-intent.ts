import { stripMarkup } from './blog-text-utils';

export type BlogContentMode = 'info' | 'product' | 'hybrid' | 'pillar';

export type BlogInfoSubtype =
  | 'weather'
  | 'preparation'
  | 'itinerary'
  | 'cost'
  | 'visa'
  | 'currency'
  | 'transport'
  | 'food'
  | 'attraction'
  | 'comparison'
  | 'faq'
  | 'general';

export type BlogProductSubtype =
  | 'package_intro'
  | 'package_ranking'
  | 'hotel_ranking'
  | 'deal_alert'
  | 'family'
  | 'luxury'
  | 'honeymoon'
  | 'last_minute'
  | 'general';

export type BlogReaderIntent = 'learn' | 'compare' | 'decide' | 'book' | 'risk_reduction';

export interface BlogIntentInput {
  title?: string | null;
  slug?: string | null;
  primaryKeyword?: string | null;
  angleType?: string | null;
  category?: string | null;
  contentType?: string | null;
  productId?: string | null;
  blogHtml?: string | null;
}

export interface BlogIntentProfile {
  mode: BlogContentMode;
  infoSubtype: BlogInfoSubtype | null;
  productSubtype: BlogProductSubtype | null;
  readerIntent: BlogReaderIntent;
  confidence: number;
  evidence: string[];
}

export type BlogIntentIssueSeverity = 'critical' | 'warning';

export interface BlogIntentIssue {
  code:
    | 'missing_intent_contract'
    | 'forbidden_sales_tone'
    | 'missing_required_block'
    | 'weak_reading_design'
    | 'paragraph_wall'
    | 'weak_list_or_table_shape'
    | 'weak_source_backing';
  severity: BlogIntentIssueSeverity;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface BlogIntentQualityReport {
  passed: boolean;
  score: number;
  intent: BlogIntentProfile;
  issues: BlogIntentIssue[];
}

const PRODUCT_SALES_RE = /(상품을\s*고른\s*이유|이\s*상품|상품\s*상세|출발가|특가|노팁|노쇼핑|포함\s*사항|불포함\s*사항|예약\s*마감|잔여\s*좌석)/;

const INFO_SUBTYPE_PATTERNS: Array<[BlogInfoSubtype, RegExp, string]> = [
  ['weather', /(날씨|옷차림|월별|우기|건기|기온|강수량|장마|계절)/, 'weather terms'],
  ['preparation', /(준비물|체크리스트|챙겨|필수\s*아이템|짐\s*싸기|출국\s*준비)/, 'preparation terms'],
  ['itinerary', /(일정|코스|동선|몇\s*박|당일치기|1일차|2일차|DAY\s*\d+)/i, 'itinerary terms'],
  ['cost', /(비용|가격|예산|경비|얼마|가성비|요금)/, 'cost terms'],
  ['visa', /(비자|입국|여권|서류|면세|체류|출입국)/, 'visa terms'],
  ['currency', /(환전|환율|달러|카드|현금|결제|트래블월렛|트래블로그)/, 'currency terms'],
  ['transport', /(공항|항공권|비행|교통|이동|버스|기차|택시|픽업)/, 'transport terms'],
  ['food', /(맛집|음식|먹거리|식당|카페|메뉴|현지식)/, 'food terms'],
  ['attraction', /(관광지|명소|가볼만한|입장권|투어|액티비티|스팟)/, 'attraction terms'],
  ['comparison', /(비교|차이|vs|대비|어디가\s*좋|선택)/i, 'comparison terms'],
  ['faq', /(질문|FAQ|Q&A|궁금|어떻게|왜|무엇)/i, 'faq terms'],
];

const PRODUCT_SUBTYPE_PATTERNS: Array<[BlogProductSubtype, RegExp, string]> = [
  ['hotel_ranking', /(호텔|리조트|숙소).*(랭킹|추천|BEST|베스트|순위)|mrt-hotel-ranking/i, 'hotel ranking terms'],
  ['package_ranking', /(패키지|상품).*(랭킹|추천|BEST|베스트|순위|비교)/i, 'package ranking terms'],
  ['deal_alert', /(특가|마감|할인|타임딜|잔여|긴급)/, 'deal terms'],
  ['family', /(부모님|효도|가족|시니어|60대|70대)/, 'family terms'],
  ['luxury', /(럭셔리|프리미엄|5성|고급|노팁|노쇼핑)/, 'luxury terms'],
  ['honeymoon', /(신혼|허니문|커플)/, 'honeymoon terms'],
  ['last_minute', /(출발\s*임박|마감\s*임박|오늘만|이번\s*주)/, 'last-minute terms'],
  ['package_intro', /(패키지|상품|출발|포함|불포함|항공|요금)/, 'package intro terms'],
];

function asText(input: BlogIntentInput): string {
  return [
    input.title,
    input.slug,
    input.primaryKeyword,
    input.angleType,
    input.category,
    input.contentType,
    input.blogHtml ? stripMarkup(input.blogHtml).slice(0, 2500) : '',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchFirst<T extends string>(
  text: string,
  patterns: Array<[T, RegExp, string]>,
): { value: T | null; evidence: string[] } {
  for (const [value, pattern, reason] of patterns) {
    if (pattern.test(text)) return { value, evidence: [reason] };
  }
  return { value: null, evidence: [] };
}

export function classifyBlogIntent(input: BlogIntentInput): BlogIntentProfile {
  const text = asText(input);
  const evidence: string[] = [];
  const hasProduct = Boolean(input.productId) || /package_intro|product|상품|패키지/i.test(`${input.contentType || ''} ${input.category || ''}`);
  const isPillar = /pillar/i.test(input.contentType || '');

  const info = matchFirst(text, INFO_SUBTYPE_PATTERNS);
  const product = matchFirst(text, PRODUCT_SUBTYPE_PATTERNS);
  evidence.push(...info.evidence, ...product.evidence);

  let mode: BlogContentMode = 'info';
  if (isPillar) mode = 'pillar';
  else if (hasProduct && info.value) mode = 'hybrid';
  else if (hasProduct) mode = 'product';

  let readerIntent: BlogReaderIntent = 'learn';
  if (/(비교|차이|vs|랭킹|순위|BEST|베스트)/i.test(text)) readerIntent = 'compare';
  if (/(추천|고르는|선택|가성비|예산|비용)/.test(text)) readerIntent = 'decide';
  if (/(예약|출발가|마감|특가|문의|상담)/.test(text)) readerIntent = 'book';
  if (/(주의|위험|비자|입국|우기|장마|환불|취소|필수)/.test(text)) readerIntent = 'risk_reduction';

  if (hasProduct) evidence.push('product context');
  if (isPillar) evidence.push('pillar content type');

  const confidence = Math.min(100, 45 + evidence.length * 15 + (input.primaryKeyword ? 10 : 0));

  return {
    mode,
    infoSubtype: info.value || (mode === 'info' || mode === 'hybrid' ? 'general' : null),
    productSubtype: product.value || (mode === 'product' || mode === 'hybrid' ? 'general' : null),
    readerIntent,
    confidence,
    evidence,
  };
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length;
}

function hasAny(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function addIssue(
  issues: BlogIntentIssue[],
  code: BlogIntentIssue['code'],
  severity: BlogIntentIssueSeverity,
  message: string,
  evidence?: Record<string, unknown>,
) {
  issues.push({ code, severity, message, evidence });
}

function inspectInfoContract(
  subtype: BlogInfoSubtype,
  source: string,
  plain: string,
  issues: BlogIntentIssue[],
) {
  const tableRows = countMatches(source, /(^|\n)\s*\|.+\|/g);
  const listItems = countMatches(source, /(^|\n)\s*(?:[-*]|\d+\.)\s+\S/g);
  const externalLinks = countMatches(source, /\]\(https?:\/\/(?!www\.yeosonam\.com|yeosonam\.com)[^)]+\)/g);

  if (subtype === 'weather') {
    const hasMonthly = hasAny(plain, /(1월|2월|3월|4월|5월|6월|7월|8월|9월|10월|11월|12월|월별)/);
    const hasClothing = hasAny(plain, /(옷차림|겉옷|우산|방수|신발|준비물|챙기)/);
    const hasSeasonRisk = hasAny(plain, /(우기|건기|비|강수|장마|계절|기온|체감)/);
    if (!hasMonthly || !hasClothing || !hasSeasonRisk) {
      addIssue(issues, 'missing_required_block', 'critical', 'Weather posts must include monthly weather, clothing, and season/rain risk blocks.', {
        hasMonthly,
        hasClothing,
        hasSeasonRisk,
      });
    }
    if (tableRows < 4) {
      addIssue(issues, 'weak_list_or_table_shape', 'critical', 'Weather posts need a real month/season table, not only prose.', { tableRows });
    }
  }

  if (subtype === 'preparation' && listItems < 5) {
    addIssue(issues, 'weak_list_or_table_shape', 'critical', 'Preparation posts need at least five checklist items.', { listItems });
  }

  if (subtype === 'itinerary' && countMatches(plain, /(1일차|2일차|DAY\s*\d+|오전|오후|첫째|둘째)/gi) < 2) {
    addIssue(issues, 'missing_required_block', 'critical', 'Itinerary posts need day-by-day or time-by-time structure.', {
      dayMarkers: countMatches(plain, /(1일차|2일차|DAY\s*\d+|오전|오후|첫째|둘째)/gi),
    });
  }

  if ((subtype === 'visa' || subtype === 'currency' || subtype === 'transport') && externalLinks < 1) {
    addIssue(issues, 'weak_source_backing', 'critical', 'High-change info posts need at least one authoritative external source link.', {
      externalLinks,
      subtype,
    });
  }

  if ((subtype === 'cost' || subtype === 'currency') && !hasAny(plain, /(\d[\d,]*\s*(원|만원|달러|엔|위안|페소|바트)|예산|환율)/)) {
    addIssue(issues, 'missing_required_block', 'critical', 'Cost/currency posts need concrete amounts or budget ranges.', { subtype });
  }
}

function inspectProductContract(
  subtype: BlogProductSubtype,
  plain: string,
  issues: BlogIntentIssue[],
) {
  if (subtype === 'hotel_ranking') {
    const hasHotelFacts = hasAny(plain, /(위치|객실|조식|수영장|리뷰|평점|가족|커플)/);
    if (!hasHotelFacts) {
      addIssue(issues, 'missing_required_block', 'critical', 'Hotel ranking posts need location, room, review, and fit-for-reader facts.');
    }
  }

  if (subtype === 'package_intro' || subtype === 'package_ranking' || subtype === 'general') {
    const hasCommercialFacts = hasAny(plain, /(항공|일정|포함|불포함|요금|가격|출발|예약|상담)/);
    if (!hasCommercialFacts) {
      addIssue(issues, 'missing_required_block', 'critical', 'Product posts need itinerary, inclusion, price, departure, or booking facts.');
    }
  }
}

function inspectReadingDesign(source: string, plain: string, issues: BlogIntentIssue[]) {
  const paragraphs = source
    .split(/\n{2,}/)
    .map((p) => stripMarkup(p).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const longParagraphs = paragraphs.filter((p) => p.length >= 520);
  const h2Count = countMatches(source, /(^|\n)##\s+\S/g);
  const listItems = countMatches(source, /(^|\n)\s*(?:[-*]|\d+\.)\s+\S/g);
  const tables = countMatches(source, /(^|\n)\s*\|.+\|/g);
  const markCount = countMatches(source, /==[^=\n]{3,120}==|<mark\b/gi);
  const tipCount = countMatches(source, /:::tip|<aside[^>]+class=["'][^"']*tip/gi);
  const warnCount = countMatches(source, /:::warn|<aside[^>]+class=["'][^"']*warn/gi);
  const numericFacts = countMatches(plain, /\d[\d,]*(?:\s*(?:원|만원|엔|달러|위안|페소|바트|%|℃|도|분|시간|박|일|km|m))?/g);

  if (longParagraphs.length > 0) {
    addIssue(issues, 'paragraph_wall', longParagraphs.length >= 2 ? 'critical' : 'warning', 'Article has wall-of-text paragraphs that reduce scanability.', {
      count: longParagraphs.length,
      longest: longParagraphs[0]?.slice(0, 120),
    });
  }

  if (h2Count < 4) {
    addIssue(issues, 'weak_reading_design', 'critical', 'Article needs at least four H2 sections for scanability.', { h2Count });
  }

  if (listItems < 3 && tables < 3) {
    addIssue(issues, 'weak_list_or_table_shape', 'critical', 'Article needs real lists or tables so readers can scan the answer.', { listItems, tableRows: tables });
  }

  if (markCount + tipCount + warnCount < 2 || numericFacts < 6) {
    addIssue(issues, 'weak_reading_design', 'warning', 'Article needs stronger reading design: highlights, tip/warn boxes, or concrete numeric anchors.', {
      markCount,
      tipCount,
      warnCount,
      numericFacts,
    });
  }
}

export function inspectBlogIntentQuality(input: BlogIntentInput): BlogIntentQualityReport {
  const intent = classifyBlogIntent(input);
  const source = input.blogHtml || '';
  const plain = stripMarkup(source).replace(/\s+/g, ' ').trim();
  const issues: BlogIntentIssue[] = [];

  if (intent.confidence < 60) {
    addIssue(issues, 'missing_intent_contract', 'critical', 'Blog topic could not be mapped to a reliable intent contract.', {
      confidence: intent.confidence,
      evidence: intent.evidence,
    });
  }

  if (intent.mode === 'info' && intent.infoSubtype && intent.infoSubtype !== 'general' && PRODUCT_SALES_RE.test(plain)) {
    addIssue(issues, 'forbidden_sales_tone', 'critical', 'Informational article contains product-sales wording.', {
      subtype: intent.infoSubtype,
      sample: plain.match(PRODUCT_SALES_RE)?.[0],
    });
  }

  if (intent.infoSubtype) inspectInfoContract(intent.infoSubtype, source, plain, issues);
  if (intent.productSubtype) inspectProductContract(intent.productSubtype, plain, issues);
  inspectReadingDesign(source, plain, issues);

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const score = Math.max(0, 100 - criticalCount * 18 - warningCount * 6);

  return {
    passed: criticalCount === 0 && score >= 85,
    score,
    intent,
    issues,
  };
}

export function buildBlogIntentPromptContract(profile: BlogIntentProfile): string {
  const parts = [
    `Content mode: ${profile.mode}`,
    profile.infoSubtype ? `Info subtype: ${profile.infoSubtype}` : null,
    profile.productSubtype ? `Product subtype: ${profile.productSubtype}` : null,
    `Reader intent: ${profile.readerIntent}`,
  ].filter(Boolean);

  const blocks: string[] = [];
  if (profile.infoSubtype === 'weather') {
    blocks.push('Required blocks: monthly/season table, clothing checklist, rainy/season risk, best timing, FAQ.');
    blocks.push('Forbidden: product-sales section headings such as "상품을 고른 이유", "특가", "출발가" unless the post is explicitly hybrid.');
  } else if (profile.infoSubtype === 'preparation') {
    blocks.push('Required blocks: checklist, documents/money/connectivity/medicine groups, warning box, FAQ.');
  } else if (profile.infoSubtype === 'itinerary') {
    blocks.push('Required blocks: day-by-day or time-by-time route, movement time, rest points, budget notes.');
  } else if (profile.infoSubtype === 'visa') {
    blocks.push('Required blocks: official source link, updated date, eligibility, documents, exception/warning box.');
  } else if (profile.productSubtype) {
    blocks.push('Required blocks: who this fits, itinerary/value proof, included/excluded, price/departure facts, CTA.');
  }

  blocks.push('Reading design: short paragraphs, at least one scan-friendly list/table, ==highlight==, concrete numeric anchors, and tip/warn boxes when useful.');

  return `## Content intent contract\n- ${parts.join('\n- ')}\n- ${blocks.join('\n- ')}`;
}
