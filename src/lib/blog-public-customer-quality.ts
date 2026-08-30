import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

export type PublicBlogCustomerQualitySeverity = 'critical' | 'major' | 'minor';

export type PublicBlogCustomerQualityIssueCode =
  | 'broken_table_surface'
  | 'generated_residue'
  | 'placeholder_copy'
  | 'duplicate_public_section'
  | 'duplicate_heading'
  | 'info_answer_mismatch'
  | 'early_sales_pressure'
  | 'hard_sales_tone'
  | 'unsupported_internal_claim'
  | 'overbuilt_mechanical_structure'
  | 'ai_cliche_tone'
  | 'public_body_too_short';

export interface PublicBlogCustomerQualityIssue {
  code: PublicBlogCustomerQualityIssueCode;
  severity: PublicBlogCustomerQualitySeverity;
  message: string;
  evidence?: Record<string, unknown>;
  recommendation: string;
}

export interface PublicBlogCustomerQualityInput {
  html: string;
  url?: string | null;
  path?: string | null;
  title?: string | null;
  expectedType?: 'info' | 'product' | 'unknown';
  expectedDestination?: string | null;
}

export interface PublicBlogCustomerQualityReport {
  passed: boolean;
  score: number;
  type: 'info' | 'product' | 'unknown';
  title: string | null;
  wordCount: number;
  metrics: {
    customer_voice: number;
    answer_fit: number;
    render_readability: number;
    trust: number;
    conversion_pressure: number;
  };
  issues: PublicBlogCustomerQualityIssue[];
  summary: string;
}

interface ExtractedPublicArticle {
  title: string | null;
  text: string;
  bodyText: string;
  firstParagraph: string;
  topThirdText: string;
  headings: string[];
  h2Count: number;
  tableCount: number;
  hrCount: number;
  tableLikeParagraphs: string[];
  htmlFragment: string;
}

export function requiresHydratedPublicBlogAudit(html: string): boolean {
  const $ = cheerio.load(html);
  const article = $('article').first();
  if (!article.length || article.find('.prose-blog').length > 0) return false;

  const pendingBoundaryCount = article.find('template[id^="P:"]').length;
  const hasReactStreamReplacer =
    /\$RS\s*=\s*function\b/.test(html)
    || /\$RS\(["']S:[^"']+["'],["']P:[^"']+["']\)/.test(html);

  return pendingBoundaryCount > 0 && hasReactStreamReplacer;
}

const WEATHER_OR_PACKING_RE =
  /날씨|옷차림|준비물|체크리스트|강수|우기|비자|입국|환전|유심|교통|공항|이동|시즌|성수기|비용|예산|보험/i;
const WEATHER_TOPIC_RE = /날씨|옷차림|준비물|체크리스트|강수|우기|건기/i;
const COST_TOPIC_RE = /비용|예산|경비|숙소|호텔|지역|쇼핑|식비|물가/i;
const INSURANCE_TOPIC_RE = /보험|보장|병원|수하물|항공\s*지연/i;
const VISA_TOPIC_RE = /비자|입국|서류|여권|무비자|체류/i;
const TRANSPORT_TOPIC_RE = /공항|교통|이동|픽업|택시|버스|환전|유심/i;
const WEATHER_ANSWER_RE =
  /(?:\d{1,2}\s*도|\d{1,2}\s*℃|기온|낮|밤|비|강수|우기|겉옷|긴팔|방수|우산|선크림|준비물|여권|환전|유심|교통|예산|비용)/i;
const COST_ANSWER_RE = /(?:1인|가족\s*총액|총액|추가비|현지\s*추가|금액|가격|예산|비용|경비|숙소|지역|동선|포함|불포함)/i;
const INSURANCE_ANSWER_RE = /(?:항공\s*지연|병원|의료|수하물|분실|보장|카드\s*보험|부족한\s*보장|여행자\s*보험)/i;
const VISA_ANSWER_RE = /(?:무비자|체류|여권|서류|입국|비자|공식\s*안내|출발\s*전|신고|심사)/i;
const TRANSPORT_ANSWER_RE = /(?:공항|시내|택시|픽업|버스|환전|유심|결제|이동\s*시간|동선|도착)/i;
const RESERVATION_FIRST_RE = /상품|패키지|상담|예약|가격|결제|문의|마감|좌석|가능 여부/i;
const HARD_CTA_RE =
  /지금\s*(?:바로\s*)?(?:예약|상담|문의|신청)|예약(?:하세요|하기|문의)|카톡\s*(?:상담|문의)|무료\s*상담|좌석\s*마감|서둘러/i;
const SOFT_CTA_RE = /내 일정 기준|가능 여부 확인|조건 확인|상담에서 확인|출발일.*확인/i;
const GENERATED_RESIDUE_RE =
  /\((?:첫|두|세)\s*번째\)|이\s*섹션은\s*주로|구체적인\s*수치보다는|아래에서\s*소개해\s*드릴|고객님의\s*모든\s*여행|각\s*섹션별로|위\s*내용을\s*바탕으로|본문에\s*삽입/i;
const PLACEHOLDER_COPY_RE =
  /#현지|현지7월|현지정보|현지자유여행|여행지\s*여행|상품\s*가격\s*변수\s*PKG|이미지\s*준비\s*중|여행\s*이미지\s*여행\s*이미지/i;
const UNSUPPORTED_INTERNAL_CLAIM_RE =
  /여소남\s*(?:내부|데이터|운영팀|검토|검증|상품\/예약\s*데이터|등록된)|운영팀이\s*검증|랜드사와\s*직접\s*확인/i;
const AI_CLICHE_RE =
  /완벽\s*가이드|총정리|꼼꼼하게\s*정리|꿈같은\s*여행|잊지\s*못할\s*추억|마법\s*같은|떠나실\s*준비|핵심\s*정보를\s*꼼꼼/i;
const PRODUCT_HINT_RE =
  /(?:\d[\d,]*\s*원\s*~?|만원\s*~?|출발|항공|포함|불포함|예약|상담|패키지|상품|가성비|프리미엄|노팁|노옵션)/i;

function textOf($: cheerio.CheerioAPI, element: AnyNode): string {
  return $(element).text().replace(/\s+/g, ' ').trim();
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSignature(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s{}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function normalizeHeadingSignature(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s{}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function addIssue(
  issues: PublicBlogCustomerQualityIssue[],
  code: PublicBlogCustomerQualityIssueCode,
  severity: PublicBlogCustomerQualitySeverity,
  message: string,
  recommendation: string,
  evidence?: Record<string, unknown>,
) {
  issues.push({ code, severity, message, recommendation, evidence });
}

function inferType(input: PublicBlogCustomerQualityInput, article: ExtractedPublicArticle): 'info' | 'product' | 'unknown' {
  if (input.expectedType && input.expectedType !== 'unknown') return input.expectedType;
  const topic = `${article.title ?? ''} ${input.path ?? ''}`;
  const haystack = `${topic} ${article.text.slice(0, 1600)}`;
  const productTitle = /(?:\d[\d,]*\s*원\s*~?|만원\s*~?|출발.*(?:패키지|상품)|(?:패키지|상품)\s*\d|가성비\s*패키지|노팁|노옵션)/i;
  if (WEATHER_OR_PACKING_RE.test(topic) && !productTitle.test(topic)) return 'info';
  if (PRODUCT_HINT_RE.test(haystack) && /원|만원|포함|불포함|출발|패키지|상품|상담/.test(haystack)) {
    return 'product';
  }
  if (WEATHER_OR_PACKING_RE.test(haystack)) return 'info';
  return 'unknown';
}

function extractPublicArticle(input: PublicBlogCustomerQualityInput): ExtractedPublicArticle {
  const $ = cheerio.load(input.html);
  $('script, style, template, noscript, svg').remove();
  const article = $('article').first();
  const root = article.length ? article : $('main').first().length ? $('main').first() : $('body');
  const bodyRoot = root.clone();
  bodyRoot.find('nav, aside, footer, [aria-label*="목차"], [aria-label*="추천"], [data-toc], [data-related-posts], [data-blog-supporting]').remove();

  const title = normalizeText(input.title || root.find('h1').first().text() || $('title').text() || '') || null;
  const text = normalizeText(root.text());
  const bodyText = normalizeText(bodyRoot.text());
  const paragraphs = bodyRoot
    .find('p, li')
    .toArray()
    .map((element) => textOf($, element))
    .filter((value) => value.length >= 30);
  const firstParagraph = paragraphs[0] || normalizeText(bodyText.slice(0, 260));
  const topThirdText = bodyText.slice(0, Math.ceil(bodyText.length * 0.34));
  const headings = bodyRoot
    .find('h2, h3')
    .toArray()
    .map((element) => textOf($, element))
    .filter(Boolean);
  const tableLikeParagraphs = [...new Set(bodyRoot
    .find('p, li')
    .toArray()
    .map((element) => textOf($, element))
    .filter((value) =>
      /^(?:\d{1,2}월|구분|항목|울란바토르|고비|홉스골|아이 동반|첫 해외여행|예산 중심)\s+/.test(value)
      && (value.match(/\d[\d,.]*(?:원|만원|℃|도|mm|일|%|분|시간)?/g) ?? []).length >= 3
      && value.split(/\s+/).length >= 4,
    ))].slice(0, 8);

  return {
    title,
    text,
    bodyText,
    firstParagraph,
    topThirdText,
    headings,
    h2Count: bodyRoot.find('h2').length,
    tableCount: bodyRoot.find('table').length,
    hrCount: bodyRoot.find('hr').length,
    tableLikeParagraphs,
    htmlFragment: bodyRoot.html() || '',
  };
}

function countDuplicateHeadings(headings: string[]): { count: number; samples: string[] } {
  const seen = new Set<string>();
  const samples: string[] = [];
  let count = 0;
  for (const heading of headings) {
    const signature = normalizeHeadingSignature(heading);
    if (!signature) continue;
    if (seen.has(signature)) {
      count += 1;
      if (samples.length < 4) samples.push(heading);
    }
    seen.add(signature);
  }
  return { count, samples };
}

function duplicateSentenceSamples(text: string): string[] {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  const sentences = text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((sentence) => normalizeText(sentence))
    .filter((sentence) => sentence.length >= 45 && sentence.length <= 220);
  for (const sentence of sentences) {
    const signature = normalizeSignature(sentence);
    if (signature.length < 35) continue;
    if (seen.has(signature) && duplicates.length < 4) {
      duplicates.push(seen.get(signature) || sentence);
      continue;
    }
    seen.set(signature, sentence);
  }
  return duplicates;
}

function visibleMatches(text: string, pattern: RegExp, limit = 5): string[] {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(global)].map((match) => match[0]).slice(0, limit);
}

function infoFirstParagraphFits(topic: string, firstParagraph: string): boolean {
  // Transport titles can legitimately mention luggage or flight-delay handling.
  // Resolve the concrete route intent before the broader insurance vocabulary.
  if (TRANSPORT_TOPIC_RE.test(topic)) return TRANSPORT_ANSWER_RE.test(firstParagraph);
  if (INSURANCE_TOPIC_RE.test(topic)) return INSURANCE_ANSWER_RE.test(firstParagraph);
  if (VISA_TOPIC_RE.test(topic)) return VISA_ANSWER_RE.test(firstParagraph);
  if (COST_TOPIC_RE.test(topic)) return COST_ANSWER_RE.test(firstParagraph);
  if (WEATHER_TOPIC_RE.test(topic)) {
    return WEATHER_ANSWER_RE.test(firstParagraph) && !RESERVATION_FIRST_RE.test(firstParagraph.slice(0, 180));
  }
  return /(?:먼저|확인|비교|준비|주의|선택|나누|챙기|줄어듭니다|쉽습니다|안전합니다)/i.test(firstParagraph);
}

function metricFromIssues(
  issues: PublicBlogCustomerQualityIssue[],
  codes: PublicBlogCustomerQualityIssueCode[],
): number {
  let score = 100;
  for (const issue of issues) {
    if (!codes.includes(issue.code)) continue;
    score -= issue.severity === 'critical' ? 35 : issue.severity === 'major' ? 22 : 10;
  }
  return Math.max(0, score);
}

function issuePenalty(issue: PublicBlogCustomerQualityIssue): number {
  if (issue.severity === 'critical') return 24;
  if (issue.severity === 'major') return 12;
  return 5;
}

export function inspectPublicBlogCustomerQuality(
  input: PublicBlogCustomerQualityInput,
): PublicBlogCustomerQualityReport {
  const article = extractPublicArticle(input);
  const type = inferType(input, article);
  const issues: PublicBlogCustomerQualityIssue[] = [];
  const wordCount = article.bodyText.split(/\s+/).filter(Boolean).length;
  const bodyCharCount = Array.from(article.bodyText.replace(/\s/g, '')).length;

  if (bodyCharCount < 520) {
    addIssue(
      issues,
      'public_body_too_short',
      'critical',
      '공개 본문이 너무 짧아 검색 의도를 끝까지 해결하기 어렵습니다.',
      '공개 본문 추출 범위를 확인하고, 독자가 실제로 판단할 수 있는 핵심 답변과 체크리스트를 보강하세요.',
      { wordCount, bodyCharCount },
    );
  }

  const brokenTableLikely =
    (article.tableCount === 0 && article.tableLikeParagraphs.length >= 3)
    || /\|\s*(?:구분|항목|월|상황)\s*\|[\s\S]{0,300}(?:\*\s*\*\s*\*|<hr\b)/i.test(article.htmlFragment);
  if (brokenTableLikely) {
    addIssue(
      issues,
      'broken_table_surface',
      'critical',
      '공개 페이지에서 표가 문단이나 구분선으로 깨져 보일 가능성이 높습니다.',
      'Markdown 표를 저장 전에 HTML table로 정상화하거나, 3행 이상 유지가 안 되면 카드형 목록으로 변환하세요.',
      {
        hrCount: article.hrCount,
        tableCount: article.tableCount,
        tableLikeParagraphs: article.tableLikeParagraphs,
      },
    );
  }

  const generatedResidue = visibleMatches(article.bodyText, GENERATED_RESIDUE_RE);
  if (generatedResidue.length > 0) {
    addIssue(
      issues,
      'generated_residue',
      'critical',
      '프롬프트/생성 과정의 작업 지시문처럼 보이는 문장이 공개 본문에 남아 있습니다.',
      '발행 전 최종 정리 단계에서 메타 지시문, 섹션 설명문, 괄호식 생성 흔적을 삭제하세요.',
      { samples: generatedResidue },
    );
  }

  const placeholders = visibleMatches(article.bodyText, PLACEHOLDER_COPY_RE);
  if (placeholders.length > 0) {
    addIssue(
      issues,
      'placeholder_copy',
      'major',
      '고객에게 그대로 보이면 안 되는 임시 표현이나 자리표시자가 남아 있습니다.',
      '목적지·상품·이미지 대체문구는 실제 고객 언어로 치환하고, 빈 상태 문구는 콘텐츠 본문에서 제외하세요.',
      { samples: placeholders },
    );
  }

  const duplicateSentences = duplicateSentenceSamples(article.bodyText);
  if (duplicateSentences.length > 0) {
    addIssue(
      issues,
      'duplicate_public_section',
      'major',
      '같거나 거의 같은 문장이 공개 본문에서 반복됩니다.',
      '하단 CTA/FAQ/운영 검증 블록이 본문과 중복 결합되지 않도록 렌더링 구간을 분리하세요.',
      { samples: duplicateSentences },
    );
  }

  const duplicateHeadings = countDuplicateHeadings(article.headings);
  if (duplicateHeadings.count > 0) {
    addIssue(
      issues,
      'duplicate_heading',
      'major',
      '같은 제목이 반복되어 목차와 본문 흐름이 기계적으로 보입니다.',
      '본문 생성 블록과 공통 하단 블록의 제목 중복을 제거하고, 목차에는 실제 본문 제목만 넣으세요.',
      duplicateHeadings,
    );
  }

  if (type === 'info') {
    const topic = `${article.title ?? ''} ${input.path ?? ''}`;
    if (WEATHER_OR_PACKING_RE.test(topic) && !infoFirstParagraphFits(topic, article.firstParagraph)) {
      addIssue(
        issues,
        'info_answer_mismatch',
        'critical',
        '정보성 글 첫 문단이 독자의 질문에 바로 답하지 못하고 예약/비용 이야기로 빗나갑니다.',
        '첫 120~180자는 날씨·옷차림·준비물처럼 검색어가 묻는 답부터 주고, 예약/상품 이야기는 하단으로 내리세요.',
        { firstParagraph: article.firstParagraph.slice(0, 220) },
      );
    }

    if (HARD_CTA_RE.test(article.topThirdText)) {
      addIssue(
        issues,
        'early_sales_pressure',
        'critical',
        '정보성 글 상단에 강한 상담/예약 유도가 있어 신뢰가 떨어질 수 있습니다.',
        '정보성 글은 상단에서 답을 끝내고, CTA는 마지막에 “내 일정 기준으로 확인”처럼 약하게 1회만 두세요.',
        { samples: visibleMatches(article.topThirdText, HARD_CTA_RE, 3) },
      );
    }
  }

  const hardSales = visibleMatches(article.bodyText, HARD_CTA_RE);
  if (hardSales.length >= 3 && !SOFT_CTA_RE.test(article.bodyText)) {
    addIssue(
      issues,
      'hard_sales_tone',
      'major',
      '상담·예약 유도가 반복되어 고객 입장에서는 광고처럼 느껴질 수 있습니다.',
      '상품글도 “예약하세요”보다 “출발일/인원 기준 가능 여부 확인” 식의 판단 보조 문장으로 바꾸세요.',
      { samples: hardSales.slice(0, 5) },
    );
  }

  const internalClaims = visibleMatches(article.bodyText, UNSUPPORTED_INTERNAL_CLAIM_RE);
  if (internalClaims.length > 0) {
    addIssue(
      issues,
      'unsupported_internal_claim',
      'minor',
      '내부 데이터·운영팀 검증 표현은 보이지만, 독자가 확인할 수 있는 근거가 약합니다.',
      '내부 검증 문구는 상품 DB/랜드사 확인일/공식 링크처럼 확인 가능한 근거가 있을 때만 노출하세요.',
      { samples: internalClaims },
    );
  }

  if (article.h2Count >= 11 || article.headings.length >= 16) {
    addIssue(
      issues,
      'overbuilt_mechanical_structure',
      'minor',
      '제목 수가 많아 사람이 쓴 글보다 자동 조립된 문서처럼 보일 수 있습니다.',
      '정보성은 5~8개 핵심 구간, 상품성은 판단에 필요한 구간만 남기고 공통 하단 블록은 목차에서 제외하세요.',
      { h2Count: article.h2Count, headingCount: article.headings.length },
    );
  }

  const clicheHits = visibleMatches(article.bodyText, AI_CLICHE_RE);
  if (clicheHits.length >= 2) {
    addIssue(
      issues,
      'ai_cliche_tone',
      'major',
      'AI가 쓴 글처럼 보이는 상투적 표현이 반복됩니다.',
      '감탄형·홍보형 수식어를 줄이고, 고객이 실제로 결정해야 하는 조건과 주의점을 짧게 쓰세요.',
      { samples: clicheHits },
    );
  }

  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + issuePenalty(issue), 0));
  const metrics = {
    customer_voice: metricFromIssues(issues, ['generated_residue', 'placeholder_copy', 'duplicate_public_section', 'ai_cliche_tone']),
    answer_fit: metricFromIssues(issues, ['info_answer_mismatch', 'public_body_too_short']),
    render_readability: metricFromIssues(issues, ['broken_table_surface', 'duplicate_heading', 'overbuilt_mechanical_structure']),
    trust: metricFromIssues(issues, ['unsupported_internal_claim', 'generated_residue']),
    conversion_pressure: metricFromIssues(issues, ['early_sales_pressure', 'hard_sales_tone']),
  };
  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  const passed = criticalCount === 0 && score >= 88;

  return {
    passed,
    score,
    type,
    title: article.title,
    wordCount,
    metrics,
    issues,
    summary: passed
      ? `공개 고객품질 통과: ${score}/100, 독자 관점의 큰 파손은 발견되지 않았습니다.`
      : `공개 고객품질 실패: ${score}/100, ${issues.length}개 이슈(${criticalCount} critical)를 먼저 고쳐야 합니다.`,
  };
}
