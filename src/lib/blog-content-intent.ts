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
    | 'weak_source_backing'
    | 'repeated_ai_opening_pattern'
    | 'missing_answer_first'
    | 'early_strong_cta'
    | 'unsupported_yeosonam_data'
    | 'missing_product_consult_block';
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
  ['weather', /(weather|날씨|옷차림|월별|우기|건기|기온|강수량|장마|계절)/i, 'weather terms'],
  ['preparation', /(preparation|checklist|준비물|체크리스트|챙겨|필수\s*아이템|짐\s*싸기|출국\s*준비)/i, 'preparation terms'],
  ['itinerary', /(itinerary|route|course|일정|코스|동선|몇\s*박|당일치기|1일차|2일차|DAY\s*\d+)/i, 'itinerary terms'],
  ['cost', /(cost|budget|expense|비용|가격|예산|경비|얼마|가성비|요금|이동비|교통비|차량비|렌터카|택시|픽업)/i, 'cost terms'],
  ['visa', /(visa|immigration|passport|비자|입국|여권|서류|면세|체류|출입국)/i, 'visa terms'],
  ['currency', /(currency|exchange|money|tip|환전|환율|화폐|달러|카드|현금|결제|팁\s*문화|트래블월렛|트래블로그)/i, 'currency terms'],
  ['transport', /(transport|flight|airport|transfer|공항|항공권|비행|교통|이동|버스|기차|택시|픽업|렌터카|차량)/i, 'transport terms'],
  ['food', /(food|restaurant|cafe|맛집|음식|먹거리|식당|카페|메뉴|현지식)/i, 'food terms'],
  ['attraction', /(attraction|activity|tour|spot|관광지|명소|가볼만한|입장권|투어|액티비티|스팟)/i, 'attraction terms'],
  ['comparison', /(comparison|compare|pros|cons|analysis|best|ranking|recommend|비교|차이|장단점|분석|추천|BEST|베스트|순위|랭킹|vs|대비|어디가\s*좋|선택)/i, 'comparison terms'],
  ['faq', /(faq|question|질문|FAQ|Q&A|궁금|어떻게|왜|무엇)/i, 'faq terms'],
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

function compactText(values: Array<string | null | undefined>): string {
  return values
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bodyText(input: BlogIntentInput): string {
  return input.blogHtml ? stripMarkup(input.blogHtml).slice(0, 2500) : '';
}

function asText(input: BlogIntentInput): string {
  return [
    input.title,
    input.slug,
    input.primaryKeyword,
    input.angleType,
    input.category,
    input.contentType,
    bodyText(input),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchBestWeighted<T extends string>(
  input: BlogIntentInput,
  patterns: Array<[T, RegExp, string]>,
): { value: T | null; evidence: string[]; score: number } {
  const titleKeywordText = compactText([input.title, input.primaryKeyword]);
  const taxonomyText = compactText([input.angleType, input.category, input.contentType, input.slug]);
  const body = bodyText(input);
  let best: { value: T | null; evidence: string[]; score: number } = {
    value: null,
    evidence: [],
    score: 0,
  };

  for (const [value, pattern, reason] of patterns) {
    let score = 0;
    const evidence: string[] = [];
    if (pattern.test(titleKeywordText)) {
      score += 8;
      evidence.push(`${reason} in title/keyword`);
    }
    if (pattern.test(taxonomyText)) {
      score += 6;
      evidence.push(`${reason} in category/type`);
    }
    if (pattern.test(body)) {
      score += 1;
      evidence.push(`${reason} in body`);
    }
    const shouldBreakWeatherTie = score === best.score && best.value === 'weather' && value !== 'weather';
    if (score > best.score || shouldBreakWeatherTie) {
      best = { value, evidence, score };
    }
  }

  return best.score >= 2 ? best : { value: null, evidence: [], score: 0 };
}

export function classifyBlogIntent(input: BlogIntentInput): BlogIntentProfile {
  const text = asText(input);
  const evidence: string[] = [];
  const hasProduct = Boolean(input.productId) || /package_intro|product|상품|패키지|출발가|노팁|노쇼핑/i.test(
    `${input.title || ''} ${input.slug || ''} ${input.primaryKeyword || ''} ${input.contentType || ''} ${input.category || ''}`,
  );
  const isPillar = /pillar/i.test(input.contentType || '');

  const info = matchBestWeighted(input, INFO_SUBTYPE_PATTERNS);
  const product = hasProduct
    ? matchBestWeighted(input, PRODUCT_SUBTYPE_PATTERNS)
    : { value: null, evidence: [], score: 0 };
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
    .filter((p) => {
      const lines = p.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) return false;
      const structuralLines = lines.filter((line) =>
        /^#{1,6}\s+/.test(line)
        || /^\|.*\|$/.test(line)
        || /^[-*]\s+/.test(line)
        || /^\d+\.\s+/.test(line)
        || /^Q[\.:)]\s*/i.test(line)
        || /^A[\.:)]\s*/i.test(line),
      ).length;
      return structuralLines / lines.length < 0.75;
    })
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
  const htmlTables = countMatches(source, /<table\b/gi);
  const decisionTableRows = tables + htmlTables * 4;
  const strongScanBlocks = decisionTableRows >= 4 || listItems >= 5 || tipCount + warnCount >= 1;

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

  if (!strongScanBlocks && (markCount + tipCount + warnCount < 2 || numericFacts < 6)) {
    addIssue(issues, 'weak_reading_design', 'warning', 'Article needs stronger reading design: real tables, checklists, tip/warn boxes, or concrete numeric anchors.', {
      markCount,
      tipCount,
      warnCount,
      numericFacts,
      decisionTableRows,
      listItems,
    });
  }
}

function firstBodyParagraph(source: string): string {
  const chunks = source
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const visibleLines = chunk
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (/^#{1,6}\s+/.test(line)) return false;
        if (/^!\[[^\]]*]\([^)]+\)/.test(line)) return false;
        if (/^\|.*\|$/.test(line)) return false;
        if (/^[-*]\s+/.test(line)) return false;
        if (/^\d+\.\s+/.test(line)) return false;
        if (/^:::/i.test(line)) return false;
        return true;
      });
    const plain = stripMarkup(visibleLines.join(' ')).replace(/\s+/g, ' ').trim();
    if (plain.length >= 20) return plain;
  }

  return '';
}

function inspectCommonEditorialContract(source: string, plain: string, issues: BlogIntentIssue[]) {
  const bannedPatterns = [
    '이게 말이 되나 싶으시죠',
    '완벽 가이드',
    '총정리',
    '여소남 에디터가 추천',
    '놓치면 후회',
    '최고의 선택',
  ];
  const matched = bannedPatterns.filter((pattern) => plain.includes(pattern) || source.includes(pattern));
  const highlightCount = countMatches(source, /==[^=\n]{3,120}==|<mark\b/gi);

  if (matched.length > 0 || highlightCount > 0) {
    addIssue(
      issues,
      'repeated_ai_opening_pattern',
      matched.includes('이게 말이 되나 싶으시죠') || highlightCount > 0 ? 'critical' : 'warning',
      'Article contains repeated AI-like editorial patterns or highlight markup that should not appear in natural blog copy.',
      { matched, highlightCount },
    );
  }

  const hasYeosonamEvidence = /(예약|상담|검색)\s*(로그|건수|데이터|집계)|GSC|서치콘솔|SERP|출처|집계\s*기간|표본|로그/i.test(plain);
  if (plain.includes('여소남 데이터') && !hasYeosonamEvidence) {
    addIssue(
      issues,
      'unsupported_yeosonam_data',
      'critical',
      'Do not mention Yeosonam data unless the evidence source or aggregation basis is stated.',
    );
  }
}

function inspectInfoWriterContract(source: string, plain: string, issues: BlogIntentIssue[]) {
  const first = firstBodyParagraph(source);
  const startsLikeGreeting = /^(안녕하세요|소중한\s*여행|여소남\s*에디터|오늘은|이번\s*글에서는)/.test(first);
  const hasAnswerSignal = /(먼저|기준|확인|준비|주의|비용|가격|날씨|동선|필요|달라질 수|좋습니다|맞습니다|줄일 수|해야|핵심|결론)/.test(first);
  const hasReadableAnswerSignal = /답부터|먼저|기준|확인|비용|가격|준비|주의|환전|입국|날씨|일정|현지|선택|쉽습니다|안전합니다/.test(first);
  const hasAnyAnswerSignal = hasAnswerSignal || hasReadableAnswerSignal;

  if ((first.length < 60 && !hasAnyAnswerSignal) || startsLikeGreeting || !hasAnyAnswerSignal) {
    addIssue(
      issues,
      'missing_answer_first',
      'critical',
      'Informational posts must answer the reader question in the first paragraph instead of opening with generic editorial setup.',
      {
        firstParagraphLength: first.length,
        startsLikeGreeting,
        hasAnswerSignal,
        sample: first.slice(0, 140),
      },
    );
  }

  const contentBeforeBottomCta = source
    .replace(/\n##\s*여행\s*상품과\s*함께\s*확인하기[\s\S]*$/i, '')
    .replace(/\n---[\s\S]*$/i, '');
  const earlySource = contentBeforeBottomCta.slice(0, Math.ceil(contentBeforeBottomCta.length * 0.3));
  const hasEarlyHardCta =
    /(상품\s*보기|패키지\s*보기|지금\s*상품|카카오|group-inquiry|\/packages\?)/i.test(earlySource)
    || /(상담|문의)\s*(?:하기|신청|남기기|바로|가능|예약|마감)/i.test(earlySource)
    || /예약\s*(?:하기|문의|상담|신청|바로|마감|가능)/i.test(earlySource);
  const hasReadableHardAction = /\/packages\?|group-inquiry|카카오|상품\s*보기|패키지\s*보기|상담\s*(?:하기|신청|문의|남기기|바로)|문의\s*(?:하기|신청|바로)|예약\s*(?:하기|신청|문의|상담|바로|마감)/i.test(earlySource);
  if (hasEarlyHardCta && hasReadableHardAction) {
    addIssue(
      issues,
      'early_strong_cta',
      'critical',
      'Informational posts can have only one soft CTA near the bottom, not a hard sales CTA in the opening third.',
    );
  }
}

function inspectProductConsultContract(source: string, issues: BlogIntentIssue[]) {
  const requiredBlocks = [
    { key: '10초 판단', pattern: /10초\s*판단/ },
    { key: '포함/불포함', pattern: /포함\/불포함|포함\s*사항.*불포함\s*사항/s },
    { key: '맞는 사람', pattern: /이런\s*분께\s*맞|fit_for/i },
    { key: '안 맞는 사람', pattern: /맞지\s*않을\s*수|not_fit_for/i },
    { key: '가격 변동 조건', pattern: /가격이\s*달라질\s*수|가격\s*변동|risk_notes/i },
    { key: '문의 전 질문', pattern: /문의\s*전\s*질문|consult_questions/i },
  ];
  const missing = requiredBlocks
    .filter((block) => !block.pattern.test(source))
    .map((block) => block.key);

  if (missing.length > 0) {
    addIssue(
      issues,
      'missing_product_consult_block',
      'critical',
      'Product posts must help the reader decide before inquiry with fit, non-fit, inclusion, risk, and question blocks.',
      { missing },
    );
  }
}

export function inspectBlogIntentQuality(input: BlogIntentInput): BlogIntentQualityReport {
  const intent = classifyBlogIntent(input);
  const source = input.blogHtml || '';
  const sourceWithoutUrls = source.replace(/https?:\/\/\S+/gi, ' ');
  const plain = stripMarkup(sourceWithoutUrls).replace(/\s+/g, ' ').trim();
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
  inspectCommonEditorialContract(sourceWithoutUrls, plain, issues);
  if (intent.mode === 'info') inspectInfoWriterContract(source, plain, issues);
  if (intent.mode === 'product' || intent.productSubtype) inspectProductConsultContract(source, issues);
  inspectReadingDesign(source, plain, issues);

  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const score = Math.max(0, 100 - criticalCount * 18 - warningCount * 6);

  return {
    passed: issues.length === 0 && score === 100,
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

  blocks.push('Reading design: short paragraphs, at least one real Markdown table for comparison-heavy topics, concrete checklists, restrained numeric anchors, and tip/warn boxes when useful. Do not use ==highlight== or <mark>.');

  return `## Content intent contract\n- ${parts.join('\n- ')}\n- ${blocks.join('\n- ')}`;
}
