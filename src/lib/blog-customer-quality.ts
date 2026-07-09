import { stripMarkup } from './blog-text-utils';

export type BlogCustomerQualityIssueSeverity = 'critical' | 'major';

export type BlogCustomerQualityIssueCode =
  | 'generic_answer_opening'
  | 'weak_answer_first'
  | 'empty_cta_residue'
  | 'chatty_intro_residue'
  | 'destination_generic_residue'
  | 'product_price_suffix_duplicate'
  | 'product_consult_repetition'
  | 'product_specificity_weak'
  | 'product_source_contract_weak'
  | 'product_evidence_omission'
  | 'product_internal_terms_leak'
  | 'placeholder_destination_copy'
  | 'unsupported_internal_data'
  | 'info_source_support_weak'
  | 'unnatural_korean_tone'
  | 'overbuilt_mechanical_structure'
  | 'early_sales_pressure'
  | 'mobile_readability_wall'
  | 'table_render_risk';

export interface BlogCustomerQualityIssue {
  code: BlogCustomerQualityIssueCode;
  severity: BlogCustomerQualityIssueSeverity;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface BlogCustomerQualityReport {
  passed: boolean;
  score: number;
  issues: BlogCustomerQualityIssue[];
  metrics: {
    customer_language: number;
    answer_usefulness: number;
    product_decision_helpfulness: number;
    naturalness: number;
    trust_and_evidence: number;
  };
  summary: string;
}

export interface BlogCustomerQualityInput {
  blogHtml: string;
  blogType: 'info' | 'product';
  title?: string | null;
  primaryKeyword?: string | null;
  destination?: string | null;
  productId?: string | null;
  generationMeta?: Record<string, unknown> | null;
}

const GENERIC_INFO_OPENINGS = [
  /답부터\s*말하면[,，]?\s*20\d{2}년\s*\d{1,2}월\s*기준\s*[^.]{0,80}(?:비용|일정|준비\s*조건)을\s*함께\s*확인해야/i,
  /먼저\s*볼\s*것은\s*예산\s*범위,\s*이동\s*순서,\s*현지\s*확인\s*사항/i,
  /비용,\s*일정,\s*준비\s*조건을\s*함께\s*확인해야\s*안전합니다/i,
];

const CUSTOMER_PLACEHOLDERS = [
  /여행지\s*여행은/,
  /솔리아_스팟가격/,
  /이미지\s*준비\s*중/i,
  /상세\s*일차별\s*일정은\s*상담에서\s*확정본\s*기준으로\s*확인해야\s*합니다/,
  /현지\s*관련\s*상품/,
  /상품\s*가격\s*변동_PKG/i,
  /여행지\s*추천\s*상품\s*미리보기/,
  /#여행정보(?:\s*#\S+){0,5}\s*#여행정보(?:\s*#\S+){0,5}\s*#여행정보/,
  /[,.\s]에서\s+가치\s*있는\s*여행/,
];

const UNSUPPORTED_INTERNAL_DATA_RE =
  /여소남(?:의)?\s*(?:내부\s*)?(?:데이터|예약\s*데이터|상담\s*데이터)(?:로\s*보면|를\s*보면|에\s*따르면|상으로는)?/i;

const READABLE_HARD_CTA_RE =
  /(?:지금|바로)\s*(?:예약|상담|문의|신청)|(?:예약|상담|문의)\s*(?:하기|신청|바로|마감)|(?:상품|패키지)\s*보기|카카오?톡\s*(?:상담|문의)|잔여\s*좌석|마감\s*임박/i;

const READABLE_GENERIC_INFO_OPENING_RE =
  /^(?:안녕하세요|이번\s*글에서는|오늘은|여소남\s*에디터|여행을\s*계획\s*중이시라면)|먼저\s*볼\s*것은\s*예산\s*범위,\s*이동\s*순서/i;

const READABLE_CHATTY_INTRO_RE =
  /(?:\uC548\uB155\uD558\uC138\uC694|hello)[,\s]*(?:\uC18C\uC911\uD55C\s*)?\uC5EC\uD589|\uC5EC\uD589\uC744\s*\uACC4\uD68D\uD558\uC2DC\uB294\s*(?:\uC5EC\uB7EC\uBD84|\uBD84\uB4E4)|\uAFB8\uAC19\uC740\s*\uC5EC\uD589|\uB354\uC5C6\uC774\s*\uC88B\uC9C0\uB9CC|\uAF3C\uAF3C\uD558\uAC8C\s*\uC815\uB9AC\uD574\s*\uB4DC\uB9BD\uB2C8\uB2E4/i;
const READABLE_EMPTY_CTA_RE =
  /(?:\uC9C0\uAE08\s*\uBC14\uB85C|\uC544\uB798|\uC5EC\uAE30)\s*(?:\uB97C|\uC744)?\s*(?:\uD074\uB9AD|\uB20C\uB7EC)\s*(?:\uD574|\uD558\uC5EC)?\s*(?:\uAFB8\uAC19\uC740|\uC990\uAC70\uC6B4|\uC644\uBCBD\uD55C)?\s*[^.\n]{0,30}(?:\uC2DC\uC791|\uD655\uC778|\uC0C1\uB2F4|\uC608\uC57D)|(?:\uBC14\uB85C\s*\uB97C\s*\uD074\uB9AD|\uC9C0\uAE08\s*\uBC14\uB85C\s*\uB97C\s*\uD074\uB9AD)/i;
const GENERIC_LOCAL_LABEL_RE =
  /(?:^|\s)\uD604\uC9C0\s*(?:\uBE44\uC6A9|\uC900\uBE44\uBB3C|\uC608\uC57D|\uC77C\uC815|\uC815\uBCF4|\uC5EC\uD589)(?=[:：\s]|$)/g;

const READABLE_AI_TONE_PATTERNS = [
  /완벽\s*가이드/g,
  /총정리/g,
  /이게\s*말이\s*되나\s*싶으시죠/g,
  /여소남\s*에디터가\s*추천/g,
  /꼭\s*챙기셔야\s*해요/g,
  /확인하셔야\s*해요/g,
  /즐거운\s*여행/g,
];

const READABLE_WEATHER_OR_PACKING_RE = /날씨|옷차림|우기|건기|기온|강수|스콜|태풍/i;
const READABLE_WEATHER_ANSWER_RE = /(?:\d{1,2}\s*도|\d{1,2}\s*℃|기온|강수|비|우산|우비|겉옷|긴팔|반팔|방수|일교차|우기|건기|스콜|태풍)/i;
const READABLE_COST_OR_RESERVATION_RE = /비용|예산|예약|상품|패키지|상담|결제|가격/i;
const CHANGEABLE_INFO_RE = /날씨|옷차림|우기|건기|기온|강수|스콜|태풍|비자|입국|세관|면세|항공|수하물|환불|취소|보험|환전|교통|공항/i;
const OFFICIAL_OR_SOURCE_RE = /0404\.go\.kr|mofa\.go\.kr|gov\.kr|airport\.kr|customs\.go\.kr|iata\.org|iatatravelcentre\.com|공식|외교부|기상청|관광청|항공사|공항|출처|확인\s*링크/i;
const PRODUCT_INTERNAL_TERMS_RE =
  /(?:커미션|수수료율|마진|원가|공급가|정산가|랜드사\s*정산|B2B|담당자명|직원명|내부\s*메모|계좌번호|입금처|도매가|대리점용|판매자용|카드\s*수수료|현금\s*유도)/i;

const MOJIBAKE_CHAR_RE = /[�媛諛留怨寃臾援湲遺鍮吏理李泥紐硫吏利]/g;
const MOJIBAKE_TOKEN_RE = /\?[^\s.,!?]{1,10}|[^\s.,!?]{0,8}[�][^\s.,!?]{0,8}/g;

function detectMojibakeText(plain: string): { count: number; samples: string[] } {
  const charCount = plain.match(MOJIBAKE_CHAR_RE)?.length ?? 0;
  const samples = [...plain.matchAll(MOJIBAKE_TOKEN_RE)]
    .map((match) => match[0])
    .filter((sample) => sample.length >= 2)
    .slice(0, 8);
  return {
    count: charCount + samples.length,
    samples,
  };
}

function addIssue(
  issues: BlogCustomerQualityIssue[],
  code: BlogCustomerQualityIssueCode,
  severity: BlogCustomerQualityIssueSeverity,
  message: string,
  evidence?: Record<string, unknown>,
) {
  issues.push({ code, severity, message, evidence });
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function countRegexMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function countReadableToneHits(plain: string): number {
  return READABLE_AI_TONE_PATTERNS.reduce((sum, pattern) => sum + countRegexMatches(plain, pattern), 0);
}

function duplicateHeadingCount(markdown: string): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1]?.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!heading) continue;
    if (seen.has(heading)) duplicates += 1;
    else seen.add(heading);
  }
  return duplicates;
}

function markdownHeadingCounts(markdown: string): { h2Count: number; headingCount: number } {
  let h2Count = 0;
  let headingCount = 0;
  for (const line of markdown.split('\n')) {
    if (!/^#{2,6}\s+\S/.test(line)) continue;
    headingCount += 1;
    if (/^##\s+\S/.test(line)) h2Count += 1;
  }
  return { h2Count, headingCount };
}

function productDecisionSignalsReadable(plain: string): number {
  const patterns = [
    /(?:\d[\d,]*\s*원|만원|가격|최저가)/,
    /(?:부산|김해|인천|대구|청주|무안|출발)/,
    /(?:\d+\s*박\s*\d+\s*일|\d+\s*박|\d+\s*일)/,
    /포함\s*\/\s*불포함|포함\s*항목|불포함\s*항목/,
    /맞는\s*(?:분|사람|고객)/,
    /맞지\s*않는\s*(?:분|사람|고객)|안\s*맞는\s*(?:분|사람|고객)/,
    /가격(?:이|은)?\s*(?:바뀌|달라지|변동)|요금(?:이|은)?\s*(?:바뀌|달라지|변동)/,
    /문의\s*전\s*(?:질문|확인|체크)/,
  ];
  return patterns.filter((pattern) => pattern.test(plain)).length;
}

function normalizeEvidenceText(value: unknown): string {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[()[\]{}"'`~!@#$%^&*_+=|\\/<>.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulEvidenceItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeEvidenceText)
    .filter((item) => item.length >= 2)
    .slice(0, 12);
}

function evidenceItemCovered(plain: string, item: string): boolean {
  if (plain.includes(item)) return true;
  const tokens = item
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]/gu, '').trim())
    .filter((token) => token.length >= 2);
  if (tokens.length === 0) return false;
  const required = Math.min(tokens.length, tokens.length >= 4 ? 2 : 1);
  return tokens.filter((token) => plain.includes(token)).length >= required;
}

function evidenceCoverage(plain: string, items: string[]): { total: number; covered: number; missing: string[] } {
  const unique = [...new Set(items)];
  const missing = unique.filter((item) => !evidenceItemCovered(plain, item));
  return {
    total: unique.length,
    covered: unique.length - missing.length,
    missing: missing.slice(0, 6),
  };
}

function firstParagraph(markdown: string): string {
  for (const chunk of markdown.split(/\n{2,}/)) {
    const withoutHeadings = chunk
      .replace(/^#{1,6}\s+.*$/gm, '')
      .trim();
    if (!withoutHeadings) continue;
    const text = stripMarkup(withoutHeadings)
      .replace(/^\|.*\|$/gm, '')
      .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length >= 25) return text;
  }
  return '';
}

function hasConcreteAnswer(text: string): boolean {
  return /(\d[\d,]*(?:원|만원|분|시간|일|박|도|℃|mm|%|벌|달러|USD)|먼저|기준|확인|비교|챙기|피하|나누|분리|정리|준비|비용|예산|경비|식비|이동비|총액|상품가|개인경비|추가비|선택\s*관광|카드\s*수수료)/.test(text);
}

function metricFromIssues(
  issues: BlogCustomerQualityIssue[],
  codes: BlogCustomerQualityIssueCode[],
): number {
  let score = 100;
  for (const issue of issues) {
    if (!codes.includes(issue.code)) continue;
    score -= issue.severity === 'critical' ? 35 : 20;
  }
  return Math.max(0, score);
}

function inspectInfo(input: BlogCustomerQualityInput, plain: string, issues: BlogCustomerQualityIssue[]) {
  const first = firstParagraph(input.blogHtml);
  const strongTopicText = `${input.title ?? ''} ${input.primaryKeyword ?? ''}`;
  if (!hasConcreteAnswer(first) || first.length < 70) {
    addIssue(
      issues,
      'weak_answer_first',
      'critical',
      '정보성 글은 첫 문단에서 고객 질문에 바로 답해야 합니다.',
      { first: first.slice(0, 160), length: first.length },
    );
  }

  if (
    READABLE_WEATHER_OR_PACKING_RE.test(strongTopicText) &&
    (!READABLE_WEATHER_ANSWER_RE.test(first) || READABLE_COST_OR_RESERVATION_RE.test(first.slice(0, 120)))
  ) {
    addIssue(
      issues,
      'weak_answer_first',
      'critical',
      '날씨/옷차림/준비물 글은 첫 문단에서 기온, 비, 옷차림, 준비물 판단을 먼저 답해야 합니다.',
      { first: first.slice(0, 180) },
    );
  }

  const genericOpening = GENERIC_INFO_OPENINGS.find((pattern) => pattern.test(first));
  if (genericOpening || READABLE_GENERIC_INFO_OPENING_RE.test(first)) {
    addIssue(
      issues,
      'generic_answer_opening',
      'major',
      '반복형 답변 도입부가 감지되었습니다. 검색어별로 고객 상황과 수치를 바꿔 써야 합니다.',
      { first: first.slice(0, 180) },
    );
  }

  const topForTone = stripMarkup(input.blogHtml)
    .replace(/^#{1,6}\s+\S.*$/gm, ' ')
    .replace(/^\|.*\|$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
  if (READABLE_CHATTY_INTRO_RE.test(first) || READABLE_CHATTY_INTRO_RE.test(topForTone)) {
    addIssue(
      issues,
      'chatty_intro_residue',
      'major',
      '정보성 자동 발행 글은 인사형 블로그 도입부보다 고객 질문에 대한 답부터 시작해야 합니다.',
      { first: first.slice(0, 180) },
    );
  }

  const early = plain.slice(0, Math.max(300, Math.floor(plain.length * 0.3)));
  if (/(상품\s*보기|패키지\s*보기|카카오톡\s*상담|바로\s*예약|예약\s*문의)/.test(early)) {
    addIssue(
      issues,
      'early_sales_pressure',
      'critical',
      '정보성 글 상단에는 강한 상품/상담 CTA가 들어가면 안 됩니다.',
    );
  }

  if (CHANGEABLE_INFO_RE.test(strongTopicText) && !OFFICIAL_OR_SOURCE_RE.test(input.blogHtml)) {
    addIssue(
      issues,
      'info_source_support_weak',
      'major',
      '변동 가능성이 큰 정보성 글은 공식/주요 확인 근거를 본문에 드러내야 합니다.',
      { topic: strongTopicText.slice(0, 160) },
    );
  }
}

function inspectReadableInfoSalesPressure(plain: string, issues: BlogCustomerQualityIssue[]) {
  const early = plain.slice(0, Math.max(300, Math.floor(plain.length * 0.3)));
  if (!READABLE_HARD_CTA_RE.test(early)) return;
  addIssue(
    issues,
    'early_sales_pressure',
    'critical',
    '정보성 글 상단에는 예약/상담/상품 보기 같은 강한 CTA를 넣으면 안 됩니다.',
  );
}

function inspectProduct(input: BlogCustomerQualityInput, plain: string, issues: BlogCustomerQualityIssue[]) {
  const first = firstParagraph(input.blogHtml);
  const firstWindow = first.slice(0, 320);
  const firstSignalCount = [
    /(?:\d[\d,]*\s*원|만원|가격|최저가)/,
    /(?:부산|김해|인천|대구|청주|무안|출발)/,
    /(?:\d+\s*박\s*\d+\s*일|\d+\s*박|\d+\s*일)/,
    /맞는\s*(?:분|사람|고객)|가족|부모님|아이|효도|자유시간|노옵션|노팁/,
  ].filter((pattern) => pattern.test(firstWindow)).length;
  if (/^\s*(?:Q\.|질문|혹시|이게\s*말이\s*되나)/i.test(first) || firstSignalCount < 2) {
    addIssue(
      issues,
      'product_specificity_weak',
      'critical',
      '상품글 첫 문단은 가격, 출발지, 기간, 맞는 고객 중 2개 이상으로 시작해야 합니다.',
      { first: first.slice(0, 180), firstSignalCount },
    );
  }
  const duplicatePriceSuffix = plain.match(/\d[\d,]*원부터부터/g);
  if (duplicatePriceSuffix?.length) {
    addIssue(
      issues,
      'product_price_suffix_duplicate',
      'critical',
      '상품 가격 문장에 "부터부터" 같은 중복 표현이 있습니다.',
      { samples: duplicatePriceSuffix.slice(0, 3) },
    );
  }

  const consultRepeat = countMatches(plain, /상담에서\s*최종\s*확인/g);
  if (consultRepeat >= 4) {
    addIssue(
      issues,
      'product_consult_repetition',
      'major',
      '상품글이 구체 정보 대신 "상담에서 최종 확인"을 반복하고 있습니다.',
      { count: consultRepeat },
    );
  }

  const readableConsultRepeat = countMatches(plain, /상담(?:에서|으로)\s*최종\s*확인|문의(?:에서|로)\s*최종\s*확인/g);
  if (readableConsultRepeat >= 3) {
    addIssue(
      issues,
      'product_consult_repetition',
      'major',
      '상품글이 구체 정보 대신 상담/문의 최종 확인 문장을 반복하고 있습니다.',
      { count: readableConsultRepeat },
    );
  }

  const decisionSignals = [
    /10초\s*판단/,
    /포함\/불포함|포함\s*사항/,
    /맞는\s*사람/,
    /맞지\s*않을\s*수\s*있는\s*사람|안\s*맞는\s*사람/,
    /가격(?:이)?\s*달라질\s*수\s*있는\s*조건|가격\s*변동/,
    /문의\s*전\s*질문/,
  ];
  const presentSignals = decisionSignals.filter((pattern) => pattern.test(plain)).length;
  const readableSignals = productDecisionSignalsReadable(plain);
  if (presentSignals < 5 && readableSignals < 6) {
    addIssue(
      issues,
      'product_specificity_weak',
      'critical',
      '상품글은 문의 전 판단에 필요한 블록을 충분히 갖춰야 합니다.',
      { presentSignals, readableSignals, requiredSignals: decisionSignals.length },
    );
  }

  const productBrief = input.generationMeta?.product_consult_brief as Record<string, unknown> | undefined;
  if (PRODUCT_INTERNAL_TERMS_RE.test(plain)) {
    addIssue(
      issues,
      'product_internal_terms_leak',
      'critical',
      '상품글에 고객 비공개 운영/정산 용어가 노출되면 안 됩니다.',
    );
  }
  if (input.blogType === 'product' && input.productId && productBrief) {
    const evidenceFieldCount = ['included', 'excluded', 'fit_for', 'not_fit_for', 'risk_notes', 'consult_questions']
      .filter((key) => Array.isArray(productBrief[key]) && (productBrief[key] as unknown[]).length > 0)
      .length;
    if (evidenceFieldCount < 5) {
      addIssue(
        issues,
        'product_specificity_weak',
        'major',
        '상품 DB 기반 브리프가 상담 판단 필드를 충분히 채우지 못했습니다.',
        { evidenceFieldCount },
      );
    }

    const requiredCoverage = [
      ['included', meaningfulEvidenceItems(productBrief.included)],
      ['excluded', meaningfulEvidenceItems(productBrief.excluded)],
      ['risk_notes', meaningfulEvidenceItems(productBrief.risk_notes)],
    ] as const;
    const weakCoverage = requiredCoverage
      .map(([field, items]) => ({ field, ...evidenceCoverage(plain, items) }))
      .filter((coverage) => coverage.total > 0 && coverage.covered === 0);
    if (weakCoverage.length > 0) {
      addIssue(
        issues,
        'product_evidence_omission',
        'critical',
        '상품 DB 브리프의 포함/불포함/주의 근거가 실제 본문에 충분히 반영되지 않았습니다.',
        { weakCoverage },
      );
    }
  }
  if (input.blogType === 'product' && input.productId && !productBrief) {
    addIssue(
      issues,
      'product_source_contract_weak',
      'critical',
      '등록 상품 기준의 상품글은 product_consult_brief 없이 발행되면 안 됩니다.',
    );
  }
}

function inspectCommon(input: BlogCustomerQualityInput, plain: string, issues: BlogCustomerQualityIssue[]) {
  const mojibake = detectMojibakeText(plain);
  if (mojibake.count >= 4) {
    addIssue(
      issues,
      'unnatural_korean_tone',
      'critical',
      '고객에게 보이는 본문에 깨진 한글/인코딩 잔여물이 남아 있습니다.',
      { count: mojibake.count, samples: mojibake.samples },
    );
  }

  const placeholder = CUSTOMER_PLACEHOLDERS.find((pattern) => pattern.test(plain));
  if (placeholder) {
    addIssue(
      issues,
      'placeholder_destination_copy',
      'critical',
      '고객에게 보이면 안 되는 placeholder/빈 템플릿 문구가 남아 있습니다.',
      { pattern: String(placeholder) },
    );
  }

  const emptyCta = plain.match(READABLE_EMPTY_CTA_RE);
  if (emptyCta) {
    addIssue(
      issues,
      'empty_cta_residue',
      'critical',
      '링크나 버튼명이 빠진 CTA 문구가 고객에게 그대로 보입니다.',
      { sample: emptyCta[0].slice(0, 140) },
    );
  }

  const genericLocalLabels = plain.match(GENERIC_LOCAL_LABEL_RE) ?? [];
  if (input.destination && genericLocalLabels.length >= 2) {
    addIssue(
      issues,
      'destination_generic_residue',
      'major',
      '목적지가 있는데도 "현지 비용/현지 준비물"처럼 비어 보이는 일반 문구가 반복됩니다.',
      { destination: input.destination, count: genericLocalLabels.length, samples: genericLocalLabels.slice(0, 5) },
    );
  }

  if (UNSUPPORTED_INTERNAL_DATA_RE.test(plain) && !/(집계\s*기준|표본|로그|기간|GSC|서치콘솔|예약\s*건수|상담\s*건수)/.test(plain)) {
    addIssue(
      issues,
      'unsupported_internal_data',
      'critical',
      '여소남 내부 데이터 표현은 집계 기준이 없으면 사용할 수 없습니다.',
    );
  }

  const readableToneHits = countReadableToneHits(plain);
  if (readableToneHits >= 3) {
    addIssue(
      issues,
      'unnatural_korean_tone',
      'major',
      '반복적인 AI/홍보형 표현이 많아 실제 상담 문장처럼 읽히지 않습니다.',
      { readableToneHits },
    );
  }

  const { h2Count, headingCount } = markdownHeadingCounts(input.blogHtml);
  const faqCount = countMatches(plain, /Q\d?\.|Q:|자주\s*묻는\s*질문/g);
  const summaryCount = countMatches(plain, /핵심\s*요약|한눈에\s*보는\s*요약/g);
  const duplicateHeadings = duplicateHeadingCount(input.blogHtml);
  if (duplicateHeadings >= 1) {
    addIssue(
      issues,
      'overbuilt_mechanical_structure',
      'major',
      '같은 제목이 반복되어 자동 생성 템플릿처럼 보입니다.',
      { duplicateHeadings },
    );
  }
  if (h2Count >= 12 || headingCount >= 22) {
    addIssue(
      issues,
      'overbuilt_mechanical_structure',
      'major',
      '\uACF5\uAC1C \uD398\uC774\uC9C0\uC5D0\uC11C \uBAA9\uCC28\uC640 \uBCF8\uBB38\uC774 \uC790\uB3D9 \uC870\uB9BD\uB41C \uBB38\uC11C\uCC98\uB7FC \uBCF4\uC77C \uC815\uB3C4\uB85C \uC81C\uBAA9 \uC218\uAC00 \uB9CE\uC2B5\uB2C8\uB2E4.',
      { h2Count, headingCount },
    );
  }
  if (h2Count >= 10 && faqCount >= 4 && summaryCount >= 2) {
    addIssue(
      issues,
      'overbuilt_mechanical_structure',
      'major',
      'H2/요약/FAQ가 과하게 반복되어 자동 생성 템플릿처럼 보입니다.',
      { h2Count, faqCount, summaryCount },
    );
  }

  const longParagraph = input.blogHtml
    .split(/\n{2,}/)
    .map((chunk) => stripMarkup(chunk).replace(/\s+/g, ' ').trim())
    .find((chunk) => chunk.length >= 360);
  if (longParagraph) {
    addIssue(
      issues,
      'mobile_readability_wall',
      'major',
      '모바일에서 한 덩어리로 보이는 긴 문단이 있어 고객이 핵심 정보를 스캔하기 어렵습니다.',
      { preview: longParagraph.slice(0, 180), length: longParagraph.length },
    );
  }

  const lines = input.blogHtml.split('\n');
  const hasBrokenTableStart = lines.some((line, index) => {
    const currentIsTable = /^\s*\|.+\|\s*$/.test(line);
    if (!currentIsTable) return false;
    const previousIsTable = index > 0 && /^\s*\|.+\|\s*$/.test(lines[index - 1] ?? '');
    if (previousIsTable) return false;
    const next = lines[index + 1] ?? '';
    return !/^\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|\s*$/.test(next);
  });
  const pseudoTableRowPattern = /^\s*[-*]\s*[^:：]{2,42}[:：]\s*.{4,}(?:\s+[\/／|]\s+.{2,}){1,}/;
  const pseudoTableListRows = lines.filter((line) => pseudoTableRowPattern.test(line)).length;
  const orphanNumericRows = lines.filter((line, index) =>
    /^\s*[\d,.]+(?:\s*(?:원|만원|달러|엔|위안|페소|바트))?(?:\s*[~–-]\s*[\d,.]+(?:\s*(?:원|만원|달러|엔|위안|페소|바트))?)?\s*$/.test(line.trim()) &&
    pseudoTableRowPattern.test(lines[index - 2] ?? '')
  ).length;
  if (hasBrokenTableStart || pseudoTableListRows >= 3 || orphanNumericRows > 0) {
    addIssue(
      issues,
      'table_render_risk',
      'critical',
      '마크다운 표 구분선이 부족해 상세 페이지에서 표가 깨질 수 있습니다.',
    );
  }
}

export function inspectBlogCustomerQuality(input: BlogCustomerQualityInput): BlogCustomerQualityReport {
  const plain = stripMarkup(input.blogHtml)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const issues: BlogCustomerQualityIssue[] = [];

  if (input.blogType === 'product') inspectProduct(input, plain, issues);
  else {
    inspectInfo(input, plain, issues);
    inspectReadableInfoSalesPressure(plain, issues);
  }
  inspectCommon(input, plain, issues);

  const metrics = {
    customer_language: metricFromIssues(issues, ['placeholder_destination_copy', 'destination_generic_residue', 'product_price_suffix_duplicate', 'unnatural_korean_tone', 'product_internal_terms_leak']),
    answer_usefulness: metricFromIssues(issues, ['weak_answer_first', 'generic_answer_opening', 'chatty_intro_residue', 'mobile_readability_wall']),
    product_decision_helpfulness: input.blogType === 'product'
      ? metricFromIssues(issues, ['product_specificity_weak', 'product_source_contract_weak', 'product_consult_repetition', 'product_evidence_omission'])
      : 100,
    naturalness: metricFromIssues(issues, ['generic_answer_opening', 'chatty_intro_residue', 'empty_cta_residue', 'overbuilt_mechanical_structure', 'product_consult_repetition', 'unnatural_korean_tone']),
    trust_and_evidence: metricFromIssues(issues, ['unsupported_internal_data', 'early_sales_pressure', 'empty_cta_residue', 'table_render_risk', 'info_source_support_weak', 'product_evidence_omission', 'product_internal_terms_leak']),
  };
  const score = Math.round(Object.values(metrics).reduce((sum, value) => sum + value, 0) / Object.values(metrics).length);
  const passed = issues.length === 0 && score >= 90;

  return {
    passed,
    score,
    issues,
    metrics,
    summary: passed
      ? 'Customer quality passed: answer, tone, trust, and decision usefulness are clean.'
      : `Customer quality ${score}/100: ${issues.map((issue) => issue.code).join(', ')}`,
  };
}
